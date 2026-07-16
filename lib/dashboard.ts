import { fetchAirportFallbacks } from "./airportFallback";
import { estimateFlightPhase, FLIGHT_LOOKBACK_HOURS } from "./flightPhase";
import { distanceKm, greatCircleRoute, HKG_AIRPORT } from "./geo";
import { fetchHkiaFlights } from "./hkia";
import { addHours, addMinutes, buildHourlyBuckets } from "./time";
import {
  describeWeatherCategory,
  fetchWeatherForAirports,
  mergeWeatherCategory,
  tafWeatherAt
} from "./weather";
import type {
  AirportMetadata,
  AirportWeather,
  DashboardData,
  DashboardOptions,
  FlightPhase,
  FlightSituationCellTone,
  FlightSituationRow,
  FlightDirection,
  NormalizedFlight,
  Region,
  RouteAirportSummary,
  RouteAirportWeatherStatus,
  RouteWeatherMatch,
  RouteWeatherSource,
  TableRow,
  TrafficType,
  WeatherAssessment,
  WeatherCategory
} from "./types";

const CACHE_MINUTES = 30;
const DEFAULT_OPTIONS: DashboardOptions = {
  direction: "both",
  traffic: "both",
  horizonHours: 12,
  refresh: false
};
const HORIZON_OPTIONS: DashboardOptions["horizonHours"][] = [6, 12, 18, 24, 30];
const SITUATION_HOURS = 16;
const BASE_SITUATION_REGIONS: Region[] = [
  "Greater China",
  "Asia",
  "Middle East",
  "Oceania",
  "America",
  "Europe"
];

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

function selectedFlights(
  flights: NormalizedFlight[],
  direction: DashboardOptions["direction"]
): NormalizedFlight[] {
  const directions = directionsFromOption(direction);
  return flights.filter((flight) => directions.includes(flight.direction));
}

function findBucketFlights(
  flights: NormalizedFlight[],
  bucket: { startsAt: string; endsAt: string }
): NormalizedFlight[] {
  return flights.filter((flight) =>
    inWindow(flight, new Date(bucket.startsAt), new Date(bucket.endsAt))
  );
}

function emptyAssessment(label: string): WeatherAssessment {
  return {
    category: "unknown",
    label,
    reasons: [],
    weatherCodes: []
  };
}

function sourceWeatherForBucket(
  flights: NormalizedFlight[],
  weatherByIata: Map<string, AirportWeather>,
  startsAt: Date,
  endsAt: Date,
  source: "METAR" | "TAF"
): { label: string; category: WeatherCategory } {
  if (flights.length === 0) {
    return { label: "NO FLIGHTS", category: "unknown" };
  }

  let category: WeatherCategory = "unknown";
  const assessed: Array<{ iata: string; assessment: WeatherAssessment }> = [];
  const sources = new Map<string, AirportWeather>();

  for (const flight of flights) {
    const airportWeather = weatherByIata.get(flight.routeAirportIata);
    if (airportWeather) {
      sources.set(airportWeather.airportIata, airportWeather);
    }
  }

  if (sources.size === 0) {
    return { label: "NOT QUERIED", category: "unknown" };
  }

  for (const airportWeather of sources.values()) {
    const assessment =
      source === "METAR"
        ? (airportWeather.metar ?? emptyAssessment("NO DATA"))
        : tafWeatherAt(airportWeather, startsAt, endsAt);
    assessed.push({ iata: airportWeather.airportIata, assessment });
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

function volumeLabel(direction: DashboardOptions["direction"]): string {
  if (direction === "arrival") {
    return "selected-window inbound flight count";
  }
  if (direction === "departure") {
    return "selected-window outbound flight count";
  }
  return "selected-window inbound + outbound flight count";
}

export function buildHourlyArrivalTable(args: {
  flights: NormalizedFlight[];
  weather: AirportWeather[];
  now: Date;
  horizonHours: DashboardOptions["horizonHours"];
  direction?: DashboardOptions["direction"];
}): { hours: DashboardData["hours"]; rows: TableRow[] } {
  const hours = buildHourlyBuckets(args.now, args.horizonHours);
  const scopedFlights = selectedFlights(args.flights, args.direction ?? "arrival");
  const weatherByIata = getWeatherByIata(args.weather);
  const bucketed = hours.map((hour) => findBucketFlights(scopedFlights, hour));

  const volumeRow: TableRow = {
    id: "flight-rate",
    label: volumeLabel(args.direction ?? "arrival"),
    values: bucketed.map((flights) => flights.length)
  };

  const tafCells = hours.map((hour, index) =>
    sourceWeatherForBucket(
      bucketed[index],
      weatherByIata,
      new Date(hour.startsAt),
      new Date(hour.endsAt),
      "TAF"
    )
  );
  const tafRow: TableRow = {
    id: "taf",
    label: "TAF forecast weather",
    values: tafCells.map((cell) => cell.label),
    weatherCategory: tafCells.map((cell) => cell.category)
  };

  const metarCells = hours.map((hour, index) =>
    sourceWeatherForBucket(
      bucketed[index],
      weatherByIata,
      new Date(hour.startsAt),
      new Date(hour.endsAt),
      "METAR"
    )
  );
  const weatherRow: TableRow = {
    id: "metar",
    label: "METAR observed weather",
    values: metarCells.map((cell) => cell.label),
    weatherCategory: metarCells.map((cell) => cell.category)
  };

  return {
    hours,
    rows: [volumeRow, weatherRow, tafRow]
  };
}

function buildSituationHours(now: Date): DashboardData["situationHours"] {
  return Array.from({ length: SITUATION_HOURS }, (_, offset) => {
    const startsAt = addHours(now, offset);
    const endsAt = addHours(now, offset + 1);
    return {
      hourOffset: offset,
      label: offset === 0 ? "T(now)" : `+${offset}`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString()
    };
  });
}

function deepConvectionStatus(args: {
  weather: AirportWeather | undefined;
  startsAt: Date;
  endsAt: Date;
  useMetar: boolean;
}): { label: string; tone: FlightSituationCellTone } {
  if (!args.weather) {
    return { label: "NO DATA", tone: "plain" };
  }

  const sources = args.useMetar
    ? args.weather.metar
      ? [
          {
            weatherCodes: args.weather.metar.weatherCodes,
            windGustKt: args.weather.metar.windGustKt,
            changeIndicator: null,
            probability: null
          }
        ]
      : []
    : args.weather.tafPeriods.filter((period) => overlaps(period, args.startsAt, args.endsAt));

  if (sources.length === 0) {
    return { label: "NO DATA", tone: "plain" };
  }

  const codes = [
    ...new Set(
      sources
        .flatMap((source) => source.weatherCodes)
        .filter((code) => /(^|\+|VC)(TS|SH)/.test(code.toUpperCase()))
    )
  ];
  const maxGust = Math.max(
    0,
    ...sources
      .map((source) => source.windGustKt ?? 0)
      .filter((gust) => Number.isFinite(gust))
  );
  const gustHit = maxGust >= 30;

  if (codes.length === 0 && !gustHit) {
    return { label: "NIL", tone: "nil" };
  }

  const sourceNotes = [
    ...new Set(
      sources
        .flatMap((source) => [
          source.changeIndicator ?? null,
          source.probability === null || source.probability === undefined
            ? null
            : `PROB${source.probability}`
        ])
        .filter((value): value is string => Boolean(value))
    )
  ];
  const parts = [
    sourceNotes.join("/"),
    codes.join("/"),
    gustHit ? `gust ${maxGust}kt` : ""
  ].filter(Boolean);
  const strongCode = codes.some((code) => code.startsWith("+"));
  return {
    label: parts.join(" "),
    tone: strongCode || maxGust >= 35 ? "alert" : "caution"
  };
}

function phaseAt(flight: NormalizedFlight, at: Date): FlightPhase {
  return estimateFlightPhase({
    at,
    scheduledTime: new Date(flight.scheduledTime),
    distanceKm: flight.distanceKm,
    direction: flight.direction
  });
}

export function buildFlightSituationTable(args: {
  flights: NormalizedFlight[];
  weather: AirportWeather[];
  now: Date;
}): { hours: DashboardData["situationHours"]; rows: FlightSituationRow[] } {
  const hours = buildSituationHours(args.now);
  const arrivalFlights = args.flights.filter((flight) => flight.direction === "arrival");
  const weatherByIata = getWeatherByIata(args.weather);
  const hkgWeather = weatherByIata.get("HKG");
  const snapshots = hours.map((hour) => {
    const at = new Date(hour.startsAt);
    return arrivalFlights.map((flight) => ({
      flight,
      phase: phaseAt(flight, at)
    }));
  });

  const arrivalRateRow: FlightSituationRow = {
    id: "predicted-arrival-rate",
    label: "predicted flight arrival rate",
    kind: "rate",
    values: hours.map((hour) => findBucketFlights(arrivalFlights, hour).length),
    tones: hours.map(() => "nil")
  };

  const convectionCells = hours.map((hour, index) =>
    deepConvectionStatus({
      weather: hkgWeather,
      startsAt: new Date(hour.startsAt),
      endsAt: new Date(hour.endsAt),
      useMetar: index === 0
    })
  );
  const convectionRow: FlightSituationRow = {
    id: "deep-convection",
    label: "deep convection alert status",
    kind: "convection",
    values: convectionCells.map((cell) => cell.label),
    tones: convectionCells.map((cell) => cell.tone)
  };

  const optionalRegions: Region[] = ["Africa", "Other"];
  const regions = [
    ...BASE_SITUATION_REGIONS,
    ...optionalRegions.filter((region) =>
      snapshots.some((items) =>
        items.some(
          (item) =>
            item.flight.region === region &&
            (item.phase === "enRoute" ||
              item.phase === "onGround" ||
              item.phase === "within100km")
        )
      )
    )
  ];
  const phaseRows: FlightSituationRow[] = regions.flatMap((region) => [
    {
      id: `${region}-en-route`,
      label: `en route from ${region}`,
      kind: "phase",
      region,
      values: snapshots.map(
        (items) =>
          items.filter((item) => item.flight.region === region && item.phase === "enRoute").length
      )
    },
    {
      id: `${region}-on-land`,
      label: `on land from ${region}`,
      kind: "phase",
      region,
      values: snapshots.map(
        (items) =>
          items.filter((item) => item.flight.region === region && item.phase === "onGround").length
      )
    },
    {
      id: `${region}-within-100km`,
      label: `within 100km from ${region}`,
      kind: "phase",
      region,
      values: snapshots.map(
        (items) =>
          items.filter((item) => item.flight.region === region && item.phase === "within100km")
            .length
      )
    }
  ]);

  return {
    hours,
    rows: [arrivalRateRow, convectionRow, ...phaseRows]
  };
}

function currentWindowFlights(args: {
  flights: NormalizedFlight[];
  now: Date;
  horizonHours: DashboardOptions["horizonHours"];
  direction?: DashboardOptions["direction"];
}): NormalizedFlight[] {
  const end = addHours(args.now, args.horizonHours);
  const scopedFlights = args.direction ? selectedFlights(args.flights, args.direction) : args.flights;
  return scopedFlights.filter((flight) => inWindow(flight, args.now, end));
}

function routeCounts(flights: NormalizedFlight[]) {
  const counts = new Map<
    string,
    {
      airport: AirportMetadata | null;
      count: number;
      arrivalCount: number;
      departureCount: number;
    }
  >();
  for (const flight of flights) {
    const existing = counts.get(flight.routeAirportIata) ?? {
      airport: flight.routeAirport,
      count: 0,
      arrivalCount: 0,
      departureCount: 0
    };
    existing.count += 1;
    if (flight.direction === "arrival") {
      existing.arrivalCount += 1;
    } else {
      existing.departureCount += 1;
    }
    counts.set(flight.routeAirportIata, existing);
  }
  return counts;
}

function overlaps(period: { startsAt: string; endsAt: string }, startsAt: Date, endsAt: Date) {
  return new Date(period.startsAt) < endsAt && new Date(period.endsAt) > startsAt;
}

function weatherStatus(
  weather: AirportWeather | undefined,
  startsAt: Date,
  endsAt: Date
): { status: RouteAirportWeatherStatus; weatherCodes: string[] } {
  if (!weather) {
    return { status: "not-queried", weatherCodes: [] };
  }

  const overlappingTaf = weather.tafPeriods.filter((period) =>
    overlaps(period, startsAt, endsAt)
  );
  const metarReported = weather.metar?.category === "reported";
  const tafReported = overlappingTaf.some((period) => period.category === "reported");
  const weatherCodes = [
    ...(metarReported ? (weather.metar?.weatherCodes ?? []) : []),
    ...overlappingTaf
      .filter((period) => period.category === "reported")
      .flatMap((period) => period.weatherCodes)
  ];

  if (metarReported && tafReported) {
    return { status: "metar-taf", weatherCodes: [...new Set(weatherCodes)] };
  }
  if (metarReported) {
    return { status: "metar", weatherCodes: [...new Set(weatherCodes)] };
  }
  if (tafReported) {
    return { status: "taf", weatherCodes: [...new Set(weatherCodes)] };
  }
  if (
    weather.metar?.category === "none" ||
    overlappingTaf.some((period) => period.category === "none")
  ) {
    return { status: "none", weatherCodes: [] };
  }
  return { status: "no-data", weatherCodes: [] };
}

export function buildRouteAirportSummaries(args: {
  flights: NormalizedFlight[];
  weather: AirportWeather[];
  now: Date;
  horizonHours: DashboardOptions["horizonHours"];
  direction: DashboardOptions["direction"];
}): RouteAirportSummary[] {
  const weatherByIata = getWeatherByIata(args.weather);
  const startsAt = args.now;
  const endsAt = addHours(args.now, args.horizonHours);
  const scoped = currentWindowFlights(args);

  return [...routeCounts(scoped).entries()]
    .map(([airportIata, value]) => {
      const status = weatherStatus(weatherByIata.get(airportIata), startsAt, endsAt);
      return {
        airportIata,
        airport: value.airport,
        count: value.count,
        arrivalCount: value.arrivalCount,
        departureCount: value.departureCount,
        weatherStatus: status.status,
        weatherCodes: status.weatherCodes
      };
    })
    .sort((a, b) => b.count - a.count || a.airportIata.localeCompare(b.airportIata));
}

function routeWeatherSources(
  weather: AirportWeather | undefined,
  startsAt: Date,
  endsAt: Date
): RouteWeatherSource[] {
  if (!weather) {
    return [];
  }

  const sources: RouteWeatherSource[] = [];
  if (weather.metar?.category === "reported") {
    sources.push({
      kind: "METAR",
      weatherCodes: weather.metar.weatherCodes,
      reasons: weather.metar.reasons,
      observedAt: weather.metar.observedAt
    });
  }

  for (const period of weather.tafPeriods) {
    if (period.category !== "reported" || !overlaps(period, startsAt, endsAt)) {
      continue;
    }
    sources.push({
      kind: "TAF",
      weatherCodes: period.weatherCodes,
      reasons: period.reasons,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      probability: period.probability,
      changeIndicator: period.changeIndicator
    });
  }

  return sources;
}

export function buildRouteWeatherMatches(args: {
  flights: NormalizedFlight[];
  weather: AirportWeather[];
  now: Date;
  horizonHours: DashboardOptions["horizonHours"];
  direction: DashboardOptions["direction"];
}): RouteWeatherMatch[] {
  const weatherByIata = getWeatherByIata(args.weather);
  const startsAt = args.now;
  const endsAt = addHours(args.now, args.horizonHours);
  const scoped = currentWindowFlights(args);

  return [...routeCounts(scoped).entries()]
    .map(([airportIata, value]) => ({
      airportIata,
      airport: value.airport,
      flightCount: value.count,
      arrivalCount: value.arrivalCount,
      departureCount: value.departureCount,
      sources: routeWeatherSources(weatherByIata.get(airportIata), startsAt, endsAt)
    }))
    .filter((match) => match.sources.length > 0)
    .sort((a, b) => b.flightCount - a.flightCount || a.airportIata.localeCompare(b.airportIata));
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
    horizonHours: HORIZON_OPTIONS.includes(horizonHours as DashboardOptions["horizonHours"])
      ? (horizonHours as DashboardOptions["horizonHours"])
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
  const fetchDirections: FlightDirection[] = [
    ...new Set<FlightDirection>(["arrival", ...directionsFromOption(options.direction)])
  ];
  const { flights: rawFlights, sourceUpdatedAt } = await fetchHkiaFlights({
    directions: fetchDirections,
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
  const weatherQueryFlights = currentWindowFlights({
    flights,
    now,
    horizonHours: options.horizonHours,
    direction: options.direction
  });
  const weatherQueryAirports = prioritizeAirportsForWeather(weatherQueryFlights, airports);
  if (airports.length > weatherQueryAirports.length) {
    warnings.push(
      `Weather lookup focused on ${weatherQueryAirports.length} top route airports out of ${airports.length} mapped airports; all route airports remain included in flight totals.`
    );
  }
  const weather = await fetchWeatherForAirports(weatherQueryAirports, warnings);
  const hourly = buildHourlyArrivalTable({
    flights,
    weather,
    now,
    horizonHours: options.horizonHours,
    direction: options.direction
  });
  const situation = buildFlightSituationTable({ flights, weather, now });
  const expiresAt = addMinutes(now, CACHE_MINUTES);

  const data: DashboardData = {
    generatedAt: now.toISOString(),
    cacheExpiresAt: expiresAt.toISOString(),
    sourceUpdatedAt,
    hours: hourly.hours,
    hourlyArrivalTable: hourly.rows,
    situationHours: situation.hours,
    flightSituationRows: situation.rows,
    routeAirportSummaries: buildRouteAirportSummaries({
      flights,
      weather,
      now,
      horizonHours: options.horizonHours,
      direction: options.direction
    }),
    routeWeatherMatches: buildRouteWeatherMatches({
      flights,
      weather,
      now,
      horizonHours: options.horizonHours,
      direction: options.direction
    }),
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
