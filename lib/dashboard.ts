import { fetchAirportFallbacks } from "./airportFallback";
import { REGIONS } from "./airports";
import { estimateFlightPhase, FLIGHT_LOOKBACK_HOURS } from "./flightPhase";
import { distanceKm, greatCircleRoute, HKG_AIRPORT } from "./geo";
import { fetchHkiaFlights } from "./hkia";
import { addHours, addMinutes, buildHourlyBuckets } from "./time";
import {
  describeWeatherCategory,
  fetchWeatherForAirports,
  mergeWeatherCategory,
  tafWeatherAt,
  weatherAt
} from "./weather";
import type {
  AirportMetadata,
  AirportWeather,
  DashboardData,
  DashboardOptions,
  FlightDirection,
  FlightPhase,
  HorizonAirportSummary,
  HorizonSummary,
  NormalizedFlight,
  TableRow,
  TrafficType,
  WeatherAssessment,
  WeatherCategory
} from "./types";

const CACHE_MINUTES = 30;
const DEFAULT_OPTIONS: DashboardOptions = {
  direction: "both",
  traffic: "both",
  horizonHours: 15,
  refresh: false
};

let cache:
  | {
      key: string;
      expiresAt: number;
      data: DashboardData;
    }
  | undefined;

function directionsFromOption(option: DashboardOptions["direction"]): FlightDirection[] {
  return option === "both" ? ["arrival", "departure"] : [option];
}

function trafficFromOption(option: DashboardOptions["traffic"]): TrafficType[] {
  return option === "both" ? ["passenger", "cargo"] : [option];
}

function inWindow(flight: NormalizedFlight, start: Date, end: Date): boolean {
  const time = new Date(flight.scheduledTime);
  return time >= start && time < end;
}

function enrichFlightsWithFallbacks(
  flights: NormalizedFlight[],
  fallbacks: Map<string, AirportMetadata>,
  now: Date
): NormalizedFlight[] {
  return flights.map((flight) => {
    if (flight.routeAirport) {
      return flight;
    }

    const airport = fallbacks.get(flight.routeAirportIata);
    if (!airport) {
      return flight;
    }

    const distance = distanceKm(airport, HKG_AIRPORT);
    const route =
      flight.direction === "arrival"
        ? greatCircleRoute(airport, HKG_AIRPORT)
        : greatCircleRoute(HKG_AIRPORT, airport);

    const statusNow = estimateFlightPhase({
      at: now,
      scheduledTime: new Date(flight.scheduledTime),
      distanceKm: distance,
      direction: flight.direction
    });

    return {
      ...flight,
      routeAirport: airport,
      region: airport.region,
      distanceKm: distance,
      statusNow,
      route
    };
  });
}

function prioritizeAirportsForWeather(
  flights: NormalizedFlight[],
  airports: AirportMetadata[],
  limit = 72
): AirportMetadata[] {
  const counts = new Map<string, number>([["HKG", Number.MAX_SAFE_INTEGER]]);
  for (const flight of flights) {
    counts.set(flight.routeAirportIata, (counts.get(flight.routeAirportIata) ?? 0) + 1);
  }

  return [...airports]
    .sort((a, b) => (counts.get(b.iata) ?? 0) - (counts.get(a.iata) ?? 0))
    .slice(0, limit);
}

function getWeatherByIata(weather: AirportWeather[]): Map<string, AirportWeather> {
  return new Map(weather.map((risk) => [risk.airportIata, risk]));
}

function weatherForFlightAtScheduledTime(
  flight: NormalizedFlight,
  weather: AirportWeather,
  now: Date
): WeatherAssessment {
  const scheduled = new Date(flight.scheduledTime);
  const endsAt = addHours(scheduled, 1);
  const includeMetar = scheduled < addHours(now, 1);
  return weatherAt(weather, scheduled, endsAt, includeMetar);
}

function topAirportSummaries(
  flights: NormalizedFlight[],
  weatherByIata: Map<string, AirportWeather>,
  limit = 8
): HorizonAirportSummary[] {
  const counts = new Map<string, { airport: AirportMetadata | null; count: number }>();
  for (const flight of flights) {
    const existing = counts.get(flight.routeAirportIata) ?? {
      airport: flight.routeAirport,
      count: 0
    };
    existing.count += 1;
    counts.set(flight.routeAirportIata, existing);
  }

  return [...counts.entries()]
    .map(([airportIata, value]) => ({
      airportIata,
      airport: value.airport,
      count: value.count,
      weather: weatherByIata.get(airportIata) ?? null
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function findBucketFlights(
  flights: NormalizedFlight[],
  bucket: { startsAt: string; endsAt: string }
): NormalizedFlight[] {
  return flights.filter((flight) =>
    inWindow(flight, new Date(bucket.startsAt), new Date(bucket.endsAt))
  );
}

function reportedWeatherForBucket(
  flights: NormalizedFlight[],
  weatherByIata: Map<string, AirportWeather>,
  startsAt: Date,
  endsAt: Date,
  tafOnly: boolean,
  includeMetar: boolean
): { label: string; category: WeatherCategory } {
  let category: WeatherCategory = "unknown";
  const assessed: Array<{ iata: string; assessment: WeatherAssessment }> = [];
  const sources = new Map<string, AirportWeather>();
  const hkg = weatherByIata.get("HKG");
  if (hkg) {
    sources.set("HKG", hkg);
  }

  for (const flight of flights) {
    const source = weatherByIata.get(flight.routeAirportIata);
    if (source) {
      sources.set(source.airportIata, source);
    }
  }

  for (const source of sources.values()) {
    const assessment = tafOnly
      ? tafWeatherAt(source, startsAt, endsAt)
      : weatherAt(source, startsAt, endsAt, includeMetar);
    assessed.push({ iata: source.airportIata, assessment });
    category = mergeWeatherCategory(category, assessment.category);
  }

  const reported = assessed.filter((item) => item.assessment.category === "reported");
  const labels = reported.map((item) => item.iata).slice(0, 2);
  const codes = [...new Set(reported.flatMap((item) => item.assessment.weatherCodes))].slice(
    0,
    2
  );
  const sourceNotes = [
    ...new Set(
      reported
        .flatMap((item) => item.assessment.reasons)
        .filter((reason) => /^(TEMPO|BECMG|FM|PROB\d+)$/.test(reason))
    )
  ].slice(0, 2);
  const suffix = [codes.join("/"), sourceNotes.join("/"), labels.join("/")]
    .filter(Boolean)
    .join(" · ");
  return {
    label: `${describeWeatherCategory(category)}${suffix ? ` ${suffix}` : ""}`,
    category
  };
}

function selectedFlights(
  flights: NormalizedFlight[],
  direction: DashboardOptions["direction"]
): NormalizedFlight[] {
  const directions = directionsFromOption(direction);
  return flights.filter((flight) => directions.includes(flight.direction));
}

function volumeLabel(direction: DashboardOptions["direction"]): string {
  if (direction === "arrival") {
    return "predicted flight arrival rate";
  }
  if (direction === "departure") {
    return "predicted flight departure rate";
  }
  return "predicted arrival + departure rate";
}

function statusRowLabel(
  direction: DashboardOptions["direction"],
  status: FlightPhase,
  region: string
): string {
  if (status === "unknown") {
    return `status unavailable linked with ${region}`;
  }
  if (direction === "arrival") {
    return status === "onGround"
      ? `on ground at origin from ${region}`
      : status === "within100km"
        ? `within 100km of HK from ${region}`
        : `en route from ${region}`;
  }

  if (direction === "departure") {
    return status === "onGround"
      ? `on ground at HKIA to ${region}`
      : status === "within100km"
        ? `within 100km of HK to ${region}`
        : `en route to ${region}`;
  }

  return status === "onGround"
    ? `on ground at origin/HKIA linked with ${region}`
    : status === "within100km"
      ? `within 100km of HK linked with ${region}`
      : `en route linked with ${region}`;
}

export function buildHourlyArrivalTable(args: {
  flights: NormalizedFlight[];
  weather: AirportWeather[];
  now: Date;
  horizonHours: DashboardOptions["horizonHours"];
  direction?: DashboardOptions["direction"];
}): { hours: DashboardData["hours"]; rows: TableRow[] } {
  const hours = buildHourlyBuckets(args.now, args.horizonHours + 1);
  const scopedFlights = selectedFlights(args.flights, args.direction ?? "arrival");
  const weatherByIata = getWeatherByIata(args.weather);
  const bucketed = hours.map((hour) => findBucketFlights(scopedFlights, hour));
  const snapshots = hours.map((hour) => {
    const at = new Date(hour.startsAt);
    return scopedFlights
      .map((flight) => ({
        flight,
        phase: estimateFlightPhase({
          at,
          scheduledTime: new Date(flight.scheduledTime),
          distanceKm: flight.distanceKm,
          direction: flight.direction
        })
      }))
      .filter((item) => item.phase !== "completed");
  });

  const volumeRow: TableRow = {
    id: "flight-rate",
    label: volumeLabel(args.direction ?? "arrival"),
    values: bucketed.map((flights) => flights.length)
  };

  const tafCells = hours.map((hour, index) =>
    reportedWeatherForBucket(
      snapshots[index].map((item) => item.flight),
      weatherByIata,
      new Date(hour.startsAt),
      new Date(hour.endsAt),
      true,
      false
    )
  );
  const tafRow: TableRow = {
    id: "taf",
    label: "TAF",
    values: tafCells.map((cell) => cell.label),
    weatherCategory: tafCells.map((cell) => cell.category)
  };

  const weatherCells = hours.map((hour, index) =>
    reportedWeatherForBucket(
      snapshots[index].map((item) => item.flight),
      weatherByIata,
      new Date(hour.startsAt),
      new Date(hour.endsAt),
      false,
      index === 0
    )
  );
  const weatherRow: TableRow = {
    id: "reported-weather",
    label: "reported weather (METAR now / TAF later; no severity rating)",
    values: weatherCells.map((cell) => cell.label),
    weatherCategory: weatherCells.map((cell) => cell.category)
  };

  const statuses: FlightPhase[] = ["enRoute", "onGround", "within100km", "unknown"];

  const regionRows = REGIONS.flatMap((region) =>
    statuses.map<TableRow>((status) => ({
      id: `${region}-${status}`,
      region,
      status,
      label: statusRowLabel(args.direction ?? "arrival", status, region),
      values: snapshots.map(
        (items) =>
          items.filter((item) => item.flight.region === region && item.phase === status).length
      )
    }))
  );

  return {
    hours,
    rows: [volumeRow, tafRow, weatherRow, ...regionRows]
  };
}

export function buildHorizonSummaries(args: {
  flights: NormalizedFlight[];
  weather: AirportWeather[];
  now: Date;
}): HorizonSummary[] {
  const weatherByIata = getWeatherByIata(args.weather);

  return ([6, 12, 18, 24, 30] as const).map((hours) => {
    const end = addHours(args.now, hours);
    const scoped = args.flights.filter((flight) => inWindow(flight, args.now, end));
    const departures = scoped.filter((flight) => flight.direction === "departure");
    const arrivals = scoped.filter((flight) => flight.direction === "arrival");
    const windowWeather = new Map(
      [...weatherByIata.entries()].map(([iata, risk]) => {
        const assessment = weatherAt(risk, args.now, end, true);
        return [iata, { ...risk, ...assessment }] as const;
      })
    );
    const impacted = scoped.filter((flight) => {
      const risk = weatherByIata.get(flight.routeAirportIata);
      if (!risk) {
        return false;
      }
      const assessment = weatherForFlightAtScheduledTime(flight, risk, args.now);
      return assessment.category === "reported";
    });

    return {
      hours,
      departureDestinations: topAirportSummaries(departures, windowWeather),
      arrivalOrigins: topAirportSummaries(arrivals, windowWeather),
      reportedWeatherAirports: topAirportSummaries(impacted, windowWeather)
    };
  });
}

export function parseDashboardOptions(url: URL): DashboardOptions {
  const direction = url.searchParams.get("direction");
  const traffic = url.searchParams.get("traffic");
  const horizonHours = Number(url.searchParams.get("horizonHours"));

  return {
    direction:
      direction === "arrival" || direction === "departure" || direction === "both"
        ? direction
        : DEFAULT_OPTIONS.direction,
    traffic:
      traffic === "passenger" || traffic === "cargo" || traffic === "both"
        ? traffic
        : DEFAULT_OPTIONS.traffic,
    horizonHours:
      horizonHours === 6 ||
      horizonHours === 12 ||
      horizonHours === 15 ||
      horizonHours === 18 ||
      horizonHours === 24 ||
      horizonHours === 30
        ? horizonHours
        : DEFAULT_OPTIONS.horizonHours,
    refresh: url.searchParams.get("refresh") === "true"
  };
}

function cacheKey(options: DashboardOptions): string {
  return JSON.stringify({
    direction: options.direction,
    traffic: options.traffic,
    horizonHours: options.horizonHours
  });
}

export async function getDashboardData(
  options: DashboardOptions = DEFAULT_OPTIONS
): Promise<DashboardData> {
  const key = cacheKey(options);
  const now = new Date();

  if (!options.refresh && cache && cache.key === key && cache.expiresAt > now.getTime()) {
    return cache.data;
  }

  const warnings: string[] = [];
  const { flights: rawFlights, sourceUpdatedAt } = await fetchHkiaFlights({
    directions: directionsFromOption(options.direction),
    trafficTypes: trafficFromOption(options.traffic),
    now,
    warnings
  });

  const dashboardStart = addHours(now, -FLIGHT_LOOKBACK_HOURS);
  const dashboardEnd = addHours(now, Math.max(31, options.horizonHours + 1));
  const timedRawFlights = rawFlights.filter((flight) =>
    inWindow(flight, dashboardStart, dashboardEnd)
  );
  const missingBeforeFallback = [
    ...new Set(
      timedRawFlights
        .filter((flight) => !flight.routeAirport)
        .map((flight) => flight.routeAirportIata)
    )
  ];
  const fallbacks =
    missingBeforeFallback.length > 0
      ? await fetchAirportFallbacks(missingBeforeFallback, warnings)
      : new Map<string, AirportMetadata>();
  const flights = enrichFlightsWithFallbacks(timedRawFlights, fallbacks, now);
  const missingAirports = [
    ...new Set(
      flights
        .filter((flight) => !flight.routeAirport)
        .map((flight) => flight.routeAirportIata)
    )
  ];

  if (missingAirports.length > 0) {
    warnings.push(`Missing airport metadata: ${missingAirports.join(", ")}`);
  }

  const routeAirports = flights
    .map((flight) => flight.routeAirport)
    .filter((airport): airport is AirportMetadata => Boolean(airport));
  const airportMap = new Map(
    [HKG_AIRPORT, ...routeAirports].map((airport) => [airport.iata, airport])
  );
  const airports = [...airportMap.values()];
  const priorityFlights = flights.filter((flight) => flight.statusNow !== "completed");
  const priorityAirports = prioritizeAirportsForWeather(priorityFlights, airports);
  if (airports.length > priorityAirports.length) {
    warnings.push(
      `Weather lookup focused on ${priorityAirports.length} priority airports out of ${airports.length} mapped airports.`
    );
  }
  const weather = await fetchWeatherForAirports(priorityAirports, warnings);
  const hourly = buildHourlyArrivalTable({
    flights,
    weather,
    now,
    horizonHours: options.horizonHours,
    direction: options.direction
  });
  const expiresAt = addMinutes(now, CACHE_MINUTES);

  const data: DashboardData = {
    generatedAt: now.toISOString(),
    cacheExpiresAt: expiresAt.toISOString(),
    sourceUpdatedAt,
    hours: hourly.hours,
    hourlyArrivalTable: hourly.rows,
    horizons: buildHorizonSummaries({ flights, weather, now }),
    flights,
    airports,
    weather,
    warnings
  };

  cache = {
    key,
    expiresAt: expiresAt.getTime(),
    data
  };

  return data;
}
