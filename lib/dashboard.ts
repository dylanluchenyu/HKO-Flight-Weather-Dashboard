import { fetchAirportFallbacks } from "./airportFallback";
import { REGIONS } from "./airports";
import { distanceKm, greatCircleRoute, HKG_AIRPORT } from "./geo";
import { fetchHkiaFlights } from "./hkia";
import { addHours, addMinutes, buildHourlyBuckets } from "./time";
import { describeRisk, fetchWeatherForAirports, highestRisk } from "./weather";
import type {
  AirportMetadata,
  ArrivalStatus,
  DashboardData,
  DashboardOptions,
  FlightDirection,
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

function estimateArrivalStatus(
  now: Date,
  scheduledArrival: Date,
  distance: number
): ArrivalStatus {
  const flightHours = Math.max(1, distance / CRUISE_SPEED_KMH + AIRBORNE_BUFFER_HOURS);
  const estimatedDeparture = new Date(
    scheduledArrival.getTime() - flightHours * 60 * 60 * 1000
  );
  const remainingHours =
    (scheduledArrival.getTime() - now.getTime()) / (60 * 60 * 1000);
  const remainingDistance = Math.max(
    0,
    Math.min(distance, remainingHours * CRUISE_SPEED_KMH)
  );

  if (remainingDistance <= 100) {
    return "within100km";
  }
  if (now < estimatedDeparture) {
    return "onLand";
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

    return {
      ...flight,
      routeAirport: airport,
      region: airport.region,
      distanceKm: distance,
      arrivalStatus:
        flight.direction === "arrival"
          ? estimateArrivalStatus(now, new Date(flight.scheduledTime), distance)
          : undefined,
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

export function buildHourlyArrivalTable(args: {
  flights: NormalizedFlight[];
  weather: WeatherRisk[];
  now: Date;
  horizonHours: DashboardOptions["horizonHours"];
}): { hours: DashboardData["hours"]; rows: TableRow[] } {
  const hours = buildHourlyBuckets(args.now, args.horizonHours + 1);
  const arrivals = args.flights.filter((flight) => flight.direction === "arrival");
  const weatherByIata = getWeatherByIata(args.weather);
  const bucketed = hours.map((hour) => findBucketFlights(arrivals, hour));

  const arrivalRateRow: TableRow = {
    id: "arrival-rate",
    label: "predicted flight arrival rate",
    values: bucketed.map((flights) => flights.length)
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

  const statusLabels: Array<{ status: ArrivalStatus; label: string }> = [
    { status: "enRoute", label: "en route from" },
    { status: "onLand", label: "on land from" },
    { status: "within100km", label: "within 100km from" }
  ];

  const regionRows = REGIONS.flatMap((region) =>
    statusLabels.map<TableRow>((statusLabel) => ({
      id: `${region}-${statusLabel.status}`,
      region,
      status: statusLabel.status,
      label: `${statusLabel.label} ${region}`,
      values: bucketed.map(
        (flights) =>
          flights.filter(
            (flight) =>
              flight.region === region && flight.arrivalStatus === statusLabel.status
          ).length
      )
    }))
  );

  return {
    hours,
    rows: [arrivalRateRow, weatherRow, ...regionRows]
  };
}

export function buildHorizonSummaries(args: {
  flights: NormalizedFlight[];
  weather: WeatherRisk[];
  now: Date;
}): HorizonSummary[] {
  const weatherByIata = getWeatherByIata(args.weather);

  return ([6, 12, 18, 24] as const).map((hours) => {
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
      horizonHours === 24
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

  const dashboardEnd = addHours(now, 24);
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
    horizonHours: options.horizonHours
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
