import { fetchAirportFallbacks } from "./airportFallback";
import { REGIONS } from "./airports";
import { distanceKm, greatCircleRoute, HKG_AIRPORT } from "./geo";
import { fetchHkiaFlights } from "./hkia";
import { addHours, addMinutes, buildHourlyBuckets } from "./time";
import {
  classifyWeatherRisk,
  describeRisk,
  fetchWeatherForAirports,
  highestRisk
} from "./weather";
import type {
  AirportMetadata,
  DashboardData,
  DashboardOptions,
  FlightDirection,
  FlightStatus,
  HorizonAirportSummary,
  HorizonSummary,
  NormalizedFlight,
  TableRow,
  TrafficType,
  WeatherRisk,
  WeatherRiskLevel
} from "./types";

const CACHE_MINUTES = 30;
const CRUISE_SPEED_KMH = 820;
const AIRBORNE_BUFFER_HOURS = 0.55;
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

function estimateFlightStatus(
  now: Date,
  scheduledTime: Date,
  distance: number,
  direction: FlightDirection
): FlightStatus {
  const flightHours = Math.max(1, distance / CRUISE_SPEED_KMH + AIRBORNE_BUFFER_HOURS);

  if (direction === "departure") {
    if (now < scheduledTime) {
      return "onLand";
    }

    const elapsedHours = (now.getTime() - scheduledTime.getTime()) / (60 * 60 * 1000);
    const distanceFromHongKong = Math.max(
      0,
      Math.min(distance, elapsedHours * CRUISE_SPEED_KMH)
    );

    if (distanceFromHongKong <= 100) {
      return "within100km";
    }
    return elapsedHours <= flightHours ? "enRoute" : "onLand";
  }

  const estimatedDeparture = new Date(scheduledTime.getTime() - flightHours * 60 * 60 * 1000);
  if (now < estimatedDeparture) {
    return "onLand";
  }

  const remainingHours = (scheduledTime.getTime() - now.getTime()) / (60 * 60 * 1000);
  const remainingDistance = Math.max(0, Math.min(distance, remainingHours * CRUISE_SPEED_KMH));
  if (remainingDistance <= 100) {
    return "within100km";
  }

  return "enRoute";
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

    const flightStatus = estimateFlightStatus(
      now,
      new Date(flight.scheduledTime),
      distance,
      flight.direction
    );

    return {
      ...flight,
      routeAirport: airport,
      region: airport.region,
      distanceKm: distance,
      arrivalStatus: flight.direction === "arrival" ? flightStatus : undefined,
      flightStatus,
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

function getWeatherByIata(weather: WeatherRisk[]): Map<string, WeatherRisk> {
  return new Map(weather.map((risk) => [risk.airportIata, risk]));
}

function topAirportSummaries(
  flights: NormalizedFlight[],
  weatherByIata: Map<string, WeatherRisk>,
  limit = 8
): HorizonAirportSummary[] {
  const counts = new Map<string, { airport?: AirportMetadata; count: number }>();
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
      weather: weatherByIata.get(airportIata)
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

function weatherForBucket(
  flights: NormalizedFlight[],
  weatherByIata: Map<string, WeatherRisk>
): { label: string; severity: WeatherRiskLevel } {
  let level: WeatherRiskLevel = weatherByIata.get("HKG")?.level ?? "nil";
  const labels = new Set<string>();

  for (const flight of flights) {
    const risk = weatherByIata.get(flight.routeAirportIata);
    if (!risk || risk.level === "nil") {
      continue;
    }
    level = highestRisk(level, risk.level);
    labels.add(flight.routeAirportIata);
  }

  if (level === "nil") {
    return { label: "NIL", severity: "nil" };
  }

  const suffix = labels.size > 0 ? ` ${[...labels].slice(0, 2).join("/")}` : "";
  return { label: `${describeRisk(level)}${suffix}`, severity: level };
}

function tafForBucket(
  flights: NormalizedFlight[],
  weatherByIata: Map<string, WeatherRisk>
): { label: string; severity: WeatherRiskLevel } {
  let level: WeatherRiskLevel = "nil";
  const labels = new Set<string>();
  const sources = new Map<string, WeatherRisk>();
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
    if (!source.rawTaf) {
      continue;
    }

    const risk = classifyWeatherRisk({
      airportIata: source.airportIata,
      airportIcao: source.airportIcao,
      taf: {
        icaoId: source.airportIcao,
        rawTAF: source.rawTaf
      }
    });

    if (risk.level === "nil") {
      continue;
    }
    level = highestRisk(level, risk.level);
    labels.add(source.airportIata);
  }

  if (level === "nil") {
    return { label: "NIL", severity: "nil" };
  }

  return {
    label: `${describeRisk(level)} ${[...labels].slice(0, 2).join("/")}`,
    severity: level
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
  status: FlightStatus,
  region: string
): string {
  if (direction === "arrival") {
    return status === "onLand"
      ? `on ground at origin from ${region}`
      : status === "within100km"
        ? `within 100km of HK from ${region}`
        : `en route from ${region}`;
  }

  if (direction === "departure") {
    return status === "onLand"
      ? `on ground at HKIA to ${region}`
      : status === "within100km"
        ? `within 100km of HK to ${region}`
        : `en route to ${region}`;
  }

  return status === "onLand"
    ? `on ground at origin/HKIA linked with ${region}`
    : status === "within100km"
      ? `within 100km of HK linked with ${region}`
      : `en route linked with ${region}`;
}

export function buildHourlyArrivalTable(args: {
  flights: NormalizedFlight[];
  weather: WeatherRisk[];
  now: Date;
  horizonHours: DashboardOptions["horizonHours"];
  direction?: DashboardOptions["direction"];
}): { hours: DashboardData["hours"]; rows: TableRow[] } {
  const hours = buildHourlyBuckets(args.now, args.horizonHours + 1);
  const scopedFlights = selectedFlights(args.flights, args.direction ?? "arrival");
  const weatherByIata = getWeatherByIata(args.weather);
  const bucketed = hours.map((hour) => findBucketFlights(scopedFlights, hour));

  const volumeRow: TableRow = {
    id: "flight-rate",
    label: volumeLabel(args.direction ?? "arrival"),
    values: bucketed.map((flights) => flights.length)
  };

  const tafCells = bucketed.map((flights) => tafForBucket(flights, weatherByIata));
  const tafRow: TableRow = {
    id: "taf",
    label: "TAF",
    values: tafCells.map((cell) => cell.label),
    severity: tafCells.map((cell) => cell.severity)
  };

  const weatherCells = bucketed.map((flights) =>
    weatherForBucket(flights, weatherByIata)
  );
  const weatherRow: TableRow = {
    id: "deep-convection-alert",
    label: "deep convection / bad weather status",
    values: weatherCells.map((cell) => cell.label),
    severity: weatherCells.map((cell) => cell.severity)
  };

  const statuses: FlightStatus[] = ["enRoute", "onLand", "within100km"];

  const regionRows = REGIONS.flatMap((region) =>
    statuses.map<TableRow>((status) => ({
      id: `${region}-${status}`,
      region,
      status,
      label: statusRowLabel(args.direction ?? "arrival", status, region),
      values: bucketed.map(
        (flights) =>
          flights.filter(
            (flight) =>
              flight.region === region && (flight.flightStatus ?? flight.arrivalStatus) === status
          ).length
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
  weather: WeatherRisk[];
  now: Date;
}): HorizonSummary[] {
  const weatherByIata = getWeatherByIata(args.weather);

  return ([6, 12, 18, 24, 30] as const).map((hours) => {
    const end = addHours(args.now, hours);
    const scoped = args.flights.filter((flight) => inWindow(flight, args.now, end));
    const departures = scoped.filter((flight) => flight.direction === "departure");
    const arrivals = scoped.filter((flight) => flight.direction === "arrival");
    const impacted = scoped.filter((flight) => {
      const risk = weatherByIata.get(flight.routeAirportIata);
      return risk && risk.level !== "nil";
    });

    return {
      hours,
      departureDestinations: topAirportSummaries(departures, weatherByIata),
      arrivalOrigins: topAirportSummaries(arrivals, weatherByIata),
      badWeatherAirports: topAirportSummaries(impacted, weatherByIata)
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

  const dashboardEnd = addHours(now, Math.max(30, options.horizonHours));
  const timedRawFlights = rawFlights.filter((flight) =>
    inWindow(flight, now, dashboardEnd)
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
  const priorityAirports = prioritizeAirportsForWeather(flights, airports);
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
