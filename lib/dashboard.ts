import {
  fetchAirLabsAirportOperationalData,
  type AirLabsAirportOperationalData,
  type AirLabsOperationalFlight
} from "./airlabs";
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
  OperationalRiskLevel,
  OperationalTrend,
  OperationalWindowStats,
  Region,
  RouteAirportTafCell,
  RouteAirportTafTimeline,
  WeatherForecastPeriod,
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
const PAST_OPERATIONAL_HOURS = 6;
const OPERATIONAL_DELAY_THRESHOLD_MINUTES = 30;
const SIGNIFICANT_GUST_KT = 30;
const STRONG_GUST_KT = 35;
const LOW_VISIBILITY_KM = 5;
const VERY_LOW_VISIBILITY_KM = 1.5;
const LOW_CEILING_FT = 1500;
const VERY_LOW_CEILING_FT = 500;
const HIGH_CANCELLATION_RATE = 10;
const HIGH_DELAY_RATE = 50;
const HIGH_AFFECTED_FLIGHTS = 5;
const MEDIUM_DELAY_RATE = 25;
const MEDIUM_AFFECTED_FLIGHTS = 2;
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
    if (flight.routeAirport) {
      counts.set(flight.routeAirportIata, (counts.get(flight.routeAirportIata) ?? 0) + 1);
    }
  }
  const airportByIata = new Map(airports.map((airport) => [airport.iata, airport]));

  return [...counts.entries()]
    .map(([iata, count]) => ({ airport: airportByIata.get(iata), count }))
    .filter((entry): entry is { airport: AirportMetadata; count: number } =>
      Boolean(entry.airport)
    )
    .sort((a, b) => b.count - a.count || a.airport.iata.localeCompare(b.airport.iata))
    .slice(0, limit)
    .map((entry) => entry.airport);
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

type SignificantWeatherSource = {
  weatherCodes: string[];
  windGustKt: number | null;
  visibility: string | number | null;
  clouds: WeatherForecastPeriod["clouds"];
};

function uniqueCodes(codes: string[]): string[] {
  return [...new Set(codes.map((code) => code.toUpperCase().trim()).filter(Boolean))];
}

function isDeepConvectionCode(code: string): boolean {
  const normalized = code.toUpperCase().trim();
  return (
    normalized.startsWith("+") ||
    normalized.includes("TS") ||
    normalized.includes("SH") ||
    /(^|VC)(SQ|FC)/.test(normalized)
  );
}

function isSignificantWeatherCode(code: string): boolean {
  const normalized = code.toUpperCase().trim();
  return (
    normalized.startsWith("+") ||
    /(TS|FG|SQ|FC|GR|GS|FZ|SS|DS|VA)/.test(normalized)
  );
}

type VisibilityDisplay = {
  source: string;
  statuteMiles: number;
  km: number;
  plus: boolean;
};

function parseVisibilityDisplay(value: string | number | null): VisibilityDisplay | null {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  if (!normalized || normalized === "CAVOK") {
    return null;
  }

  const mixedFraction = normalized.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    if (denominator !== 0) {
      const statuteMiles = whole + numerator / denominator;
      return {
        source: normalized,
        statuteMiles,
        km: statuteMiles * 1.609344,
        plus: normalized.includes("+")
      };
    }
  }

  const fraction = normalized.match(/^(\d+)\/(\d+)/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator !== 0) {
      const statuteMiles = numerator / denominator;
      return {
        source: normalized,
        statuteMiles,
        km: statuteMiles * 1.609344,
        plus: normalized.includes("+")
      };
    }
  }

  const numericMatch = normalized.match(/\d+(?:\.\d+)?/);
  if (!numericMatch) {
    return null;
  }

  const numeric = Number(numericMatch[0]);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return {
    source: normalized,
    statuteMiles: numeric,
    km: numeric * 1.609344,
    plus: normalized.includes("+")
  };
}

function parseVisibilityKm(value: string | number | null): number | null {
  return parseVisibilityDisplay(value)?.km ?? null;
}

function formatKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} km`;
}

function formatVisibility(value: string | number | null): string {
  const parsed = parseVisibilityDisplay(value);
  if (!parsed) {
    return "VIS --";
  }
  const kmLabel = formatKm(parsed.km);
  return `VIS ${parsed.source} sm / ${parsed.plus ? kmLabel.replace(" km", "+ km") : kmLabel}`;
}

function lowestCeilingFt(sources: SignificantWeatherSource[]): number | null {
  const ceilingCovers = new Set(["BKN", "OVC", "VV"]);
  const ceilings = sources
    .flatMap((source) => source.clouds)
    .filter((cloud) => cloud.baseFt !== null && ceilingCovers.has(cloud.cover ?? ""))
    .map((cloud) => cloud.baseFt as number);

  return ceilings.length > 0 ? Math.min(...ceilings) : null;
}

function formatCeilingFt(feet: number): string {
  return `${Math.round(feet / 100) * 100}ft`;
}

function significantWeatherSummary(
  sources: SignificantWeatherSource[]
): { label: string; tone: FlightSituationCellTone } {
  const codes = uniqueCodes(sources.flatMap((source) => source.weatherCodes)).filter(
    isSignificantWeatherCode
  );
  const gust = Math.max(
    0,
    ...sources
      .map((source) => source.windGustKt ?? 0)
      .filter((value) => Number.isFinite(value))
  );
  const visibilities = sources
    .map((source) => ({
      source: source.visibility,
      km: parseVisibilityKm(source.visibility)
    }))
    .filter((value): value is { source: string | number | null; km: number } => value.km !== null)
    .sort((a, b) => a.km - b.km);
  const lowestVisibility = visibilities[0] ?? null;
  const ceiling = lowestCeilingFt(sources);
  const parts = [
    ...codes.slice(0, 2),
    lowestVisibility !== null && lowestVisibility.km < LOW_VISIBILITY_KM
      ? formatVisibility(lowestVisibility.source)
      : "",
    ceiling !== null && ceiling < LOW_CEILING_FT ? `CIG ${formatCeilingFt(ceiling)}` : "",
    gust >= SIGNIFICANT_GUST_KT ? `G${gust}` : ""
  ].filter(Boolean);

  if (parts.length === 0) {
    return { label: "NIL", tone: "nil" };
  }

  const alert =
    codes.some((code) => code.startsWith("+") || /(SQ|FC)/.test(code)) ||
    gust >= STRONG_GUST_KT ||
    (lowestVisibility !== null && lowestVisibility.km < VERY_LOW_VISIBILITY_KM) ||
    (ceiling !== null && ceiling < VERY_LOW_CEILING_FT);
  return { label: parts.join("\n"), tone: alert ? "alert" : "caution" };
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
            visibility: args.weather.metar.visibility,
            clouds: args.weather.metar.clouds,
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
        .filter(isDeepConvectionCode)
    )
  ];
  const maxGust = Math.max(
    0,
    ...sources
      .map((source) => source.windGustKt ?? 0)
      .filter((gust) => Number.isFinite(gust))
  );
  const gustHit = maxGust >= SIGNIFICANT_GUST_KT;

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
    tone: strongCode || maxGust >= STRONG_GUST_KT ? "alert" : "caution"
  };
}

function tafChangePriority(period: WeatherForecastPeriod): number {
  const indicator = period.changeIndicator?.toUpperCase() ?? "";
  if (indicator.startsWith("FM")) {
    return 0;
  }
  if (indicator === "BECMG") {
    return 1;
  }
  if (indicator === "TEMPO") {
    return 2;
  }
  if (indicator.startsWith("PROB")) {
    return 3;
  }
  return 4;
}

function tafHourlyBreakdown(args: {
  weather: AirportWeather | undefined;
  startsAt: Date;
  endsAt: Date;
}): { label: string } {
  if (!args.weather) {
    return { label: "NO DATA" };
  }

  const overlapping = args.weather.tafPeriods.filter((period) =>
    overlaps(period, args.startsAt, args.endsAt)
  );
  if (overlapping.length === 0) {
    return { label: "NO DATA" };
  }

  return {
    label: significantWeatherSummary(overlapping).label
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
  const tableWindowStart = new Date(hours[0].startsAt);
  const tableWindowEnd = new Date(hours.at(-1)?.endsAt ?? hours[0].endsAt);
  const tableWindowArrivalFlights = arrivalFlights.filter((flight) =>
    inWindow(flight, tableWindowStart, tableWindowEnd)
  );
  const weatherByIata = getWeatherByIata(args.weather);
  const hkgWeather = weatherByIata.get("HKG");
  const snapshots = hours.map((hour) => {
    const at = new Date(hour.startsAt);
    return tableWindowArrivalFlights.map((flight) => ({
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

  const tafRow: FlightSituationRow = {
    id: "hkg-taf-hourly-breakdown",
    label: "HKG TAF significant weather",
    kind: "taf",
    values: hours.map((hour) =>
      tafHourlyBreakdown({
        weather: hkgWeather,
        startsAt: new Date(hour.startsAt),
        endsAt: new Date(hour.endsAt)
      }).label
    )
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
    rows: [arrivalRateRow, convectionRow, tafRow, ...phaseRows]
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

function operationalUnavailableStats(
  startsAt: Date,
  endsAt: Date,
  reason: string
): OperationalWindowStats {
  return {
    status: "unavailable",
    windowStart: startsAt.toISOString(),
    windowEnd: endsAt.toISOString(),
    totalFlights: 0,
    delayedFlights: 0,
    cancelledFlights: 0,
    affectedFlights: 0,
    delayRate: null,
    cancellationRate: null,
    unavailableReason: reason
  };
}

function operationalFlightKey(flight: AirLabsOperationalFlight): string {
  return [
    flight.flightIata ?? flight.flightIcao ?? "UNKNOWN",
    flight.depIata ?? "DEP",
    flight.arrIata ?? "ARR",
    flight.depTimeTs ?? flight.arrTimeTs ?? "TIME"
  ].join("|");
}

function operationalFlightTime(flight: AirLabsOperationalFlight): Date | null {
  const timestamp = flight.depTimeTs ?? flight.arrTimeTs;
  if (timestamp === null) {
    return null;
  }
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  return Number.isFinite(date.getTime()) ? date : null;
}

function operationalFlightInWindow(
  flight: AirLabsOperationalFlight,
  startsAt: Date,
  endsAt: Date
): boolean {
  const time = operationalFlightTime(flight);
  return Boolean(time && time >= startsAt && time < endsAt);
}

function isCancelledStatus(status: string | null): boolean {
  return /cancel/i.test(status ?? "");
}

function isDelayedFlight(flight: AirLabsOperationalFlight): boolean {
  const minutes =
    flight.delayedMinutes ?? flight.depDelayedMinutes ?? flight.arrDelayedMinutes ?? 0;
  return minutes >= OPERATIONAL_DELAY_THRESHOLD_MINUTES;
}

function buildOperationalWindowStats(args: {
  raw: AirLabsAirportOperationalData | undefined;
  startsAt: Date;
  endsAt: Date;
}): OperationalWindowStats {
  if (!args.raw) {
    return operationalUnavailableStats(args.startsAt, args.endsAt, "AirLabs data not requested.");
  }
  if (args.raw.unavailableReason) {
    return operationalUnavailableStats(args.startsAt, args.endsAt, args.raw.unavailableReason);
  }

  const schedules = args.raw.schedules.filter((flight) =>
    operationalFlightInWindow(flight, args.startsAt, args.endsAt)
  );
  if (schedules.length === 0) {
    return operationalUnavailableStats(
      args.startsAt,
      args.endsAt,
      "No AirLabs schedules in this window."
    );
  }

  const scheduleKeys = new Set(schedules.map(operationalFlightKey));
  const cancelledKeys = new Set(
    schedules.filter((flight) => isCancelledStatus(flight.status)).map(operationalFlightKey)
  );
  const delayedKeys = new Set([
    ...schedules.filter(isDelayedFlight).map(operationalFlightKey),
    ...args.raw.delays
      .filter((flight) => operationalFlightInWindow(flight, args.startsAt, args.endsAt))
      .filter(isDelayedFlight)
      .map(operationalFlightKey)
  ]);
  const affectedKeys = new Set(
    [...delayedKeys, ...cancelledKeys].filter((key) => scheduleKeys.has(key))
  );
  const totalFlights = scheduleKeys.size;
  const delayedFlights = [...delayedKeys].filter((key) => scheduleKeys.has(key)).length;
  const cancelledFlights = cancelledKeys.size;

  return {
    status: "available",
    windowStart: args.startsAt.toISOString(),
    windowEnd: args.endsAt.toISOString(),
    totalFlights,
    delayedFlights,
    cancelledFlights,
    affectedFlights: affectedKeys.size,
    delayRate: totalFlights > 0 ? (delayedFlights / totalFlights) * 100 : 0,
    cancellationRate: totalFlights > 0 ? (cancelledFlights / totalFlights) * 100 : 0
  };
}

function affectedRate(stats: OperationalWindowStats): number | null {
  return stats.status === "available" && stats.totalFlights > 0
    ? (stats.affectedFlights / stats.totalFlights) * 100
    : null;
}

function operationalTrend(
  current: OperationalWindowStats,
  past: OperationalWindowStats
): OperationalTrend {
  const currentRate = affectedRate(current);
  const pastRate = affectedRate(past);
  if (currentRate === null || pastRate === null) {
    return "unavailable";
  }
  if (currentRate - pastRate >= 5) {
    return "worse";
  }
  if (pastRate - currentRate >= 5) {
    return "recovering";
  }
  if (currentRate > 0 && pastRate > 0) {
    return "persistent";
  }
  return "stable";
}

function aggregateOperationalStats(
  stats: OperationalWindowStats[],
  startsAt: Date,
  endsAt: Date
): OperationalWindowStats {
  const available = stats.filter((item) => item.status === "available");
  if (available.length === 0) {
    return operationalUnavailableStats(startsAt, endsAt, "No available AirLabs airport stats.");
  }
  const totalFlights = available.reduce((sum, item) => sum + item.totalFlights, 0);
  const delayedFlights = available.reduce((sum, item) => sum + item.delayedFlights, 0);
  const cancelledFlights = available.reduce((sum, item) => sum + item.cancelledFlights, 0);
  const affectedFlights = available.reduce((sum, item) => sum + item.affectedFlights, 0);
  return {
    status: "available",
    windowStart: startsAt.toISOString(),
    windowEnd: endsAt.toISOString(),
    totalFlights,
    delayedFlights,
    cancelledFlights,
    affectedFlights,
    delayRate: totalFlights > 0 ? (delayedFlights / totalFlights) * 100 : 0,
    cancellationRate: totalFlights > 0 ? (cancelledFlights / totalFlights) * 100 : 0
  };
}

function weatherForRanking(
  weather: AirportWeather | undefined,
  startsAt: Date,
  endsAt: Date,
  useMetar: boolean
): {
  visibilityLabel: string;
  visibilityKm: number | null;
  weatherCodes: string[];
  tone: FlightSituationCellTone;
} {
  if (!weather) {
    return {
      visibilityLabel: "VIS --",
      visibilityKm: null,
      weatherCodes: [],
      tone: "plain"
    };
  }

  const sources = useMetar && weather.metar
    ? [
        {
          weatherCodes: weather.metar.weatherCodes,
          windGustKt: weather.metar.windGustKt,
          visibility: weather.metar.visibility,
          clouds: weather.metar.clouds
        }
      ]
    : weather.tafPeriods.filter((period) => overlaps(period, startsAt, endsAt));
  const visibility = sources
    .map((source) => ({
      source: source.visibility,
      km: parseVisibilityKm(source.visibility)
    }))
    .filter((value): value is { source: string | null; km: number } => value.km !== null)
    .sort((a, b) => a.km - b.km)[0];
  const significant = sources.length > 0 ? significantWeatherSummary(sources) : null;

  return {
    visibilityLabel: visibility ? formatVisibility(visibility.source) : "VIS --",
    visibilityKm: visibility?.km ?? null,
    weatherCodes: uniqueCodes(sources.flatMap((source) => source.weatherCodes)),
    tone: significant?.tone ?? "plain"
  };
}

function riskLevel(args: {
  stats: OperationalWindowStats;
  weatherTone: FlightSituationCellTone;
  visibilityKm: number | null;
}): { level: OperationalRiskLevel; reasons: string[] } {
  if (args.stats.status !== "available") {
    return {
      level: "unavailable",
      reasons: [args.stats.unavailableReason ?? "Operational data unavailable"]
    };
  }

  const reasons: string[] = [];
  if ((args.stats.cancellationRate ?? 0) >= HIGH_CANCELLATION_RATE) {
    reasons.push(`cancel ${Math.round(args.stats.cancellationRate ?? 0)}%`);
  }
  if ((args.stats.delayRate ?? 0) >= HIGH_DELAY_RATE) {
    reasons.push(`delay ${Math.round(args.stats.delayRate ?? 0)}%`);
  }
  if (args.stats.affectedFlights >= HIGH_AFFECTED_FLIGHTS) {
    reasons.push(`${args.stats.affectedFlights} affected`);
  }
  if (args.weatherTone === "alert") {
    reasons.push("alert weather");
  }
  if (args.visibilityKm !== null && args.visibilityKm < VERY_LOW_VISIBILITY_KM) {
    reasons.push(`VIS ${formatKm(args.visibilityKm)}`);
  }
  if (reasons.length > 0) {
    return { level: "high", reasons };
  }

  if ((args.stats.cancellationRate ?? 0) > 0) {
    reasons.push(`cancel ${Math.round(args.stats.cancellationRate ?? 0)}%`);
  }
  if ((args.stats.delayRate ?? 0) >= MEDIUM_DELAY_RATE) {
    reasons.push(`delay ${Math.round(args.stats.delayRate ?? 0)}%`);
  }
  if (args.stats.affectedFlights >= MEDIUM_AFFECTED_FLIGHTS) {
    reasons.push(`${args.stats.affectedFlights} affected`);
  }
  if (args.weatherTone === "caution") {
    reasons.push("weather watch");
  }
  if (args.visibilityKm !== null && args.visibilityKm < LOW_VISIBILITY_KM) {
    reasons.push(`VIS ${formatKm(args.visibilityKm)}`);
  }
  if (reasons.length > 0) {
    return { level: "medium", reasons };
  }

  return { level: "low", reasons: ["No threshold exceeded"] };
}

export function buildOperationalDashboardData(args: {
  originFlights: NormalizedFlight[];
  weather: AirportWeather[];
  airLabsByIata: Map<string, AirLabsAirportOperationalData>;
  now: Date;
  hours: DashboardData["hours"];
}): Pick<
  DashboardData,
  "arrivalOriginOperationalInsights" | "operationalTotals" | "hourlyRouteAirportRanking"
> {
  const startsAt = args.now;
  const endsAt = new Date(args.hours.at(-1)?.endsAt ?? addHours(args.now, 1).toISOString());
  const pastStartsAt = addHours(args.now, -PAST_OPERATIONAL_HOURS);
  const pastEndsAt = args.now;
  const weatherByIata = getWeatherByIata(args.weather);
  const originCounts = routeCounts(args.originFlights);

  const insights = [...originCounts.entries()]
    .map(([airportIata, value]) => {
      const raw = args.airLabsByIata.get(airportIata);
      const current = buildOperationalWindowStats({ raw, startsAt, endsAt });
      const past6 = buildOperationalWindowStats({
        raw,
        startsAt: pastStartsAt,
        endsAt: pastEndsAt
      });
      return {
        airportIata,
        airport: value.airport,
        routeFlightCount: value.arrivalCount,
        current,
        past6,
        trend: operationalTrend(current, past6)
      };
    })
    .sort((a, b) => {
      const affectedDelta = b.current.affectedFlights - a.current.affectedFlights;
      return affectedDelta !== 0 ? affectedDelta : a.airportIata.localeCompare(b.airportIata);
    });

  const currentAggregate = aggregateOperationalStats(
    insights.map((item) => item.current),
    startsAt,
    endsAt
  );
  const pastAggregate = aggregateOperationalStats(
    insights.map((item) => item.past6),
    pastStartsAt,
    pastEndsAt
  );
  const availableAirports = insights.filter((item) => item.current.status === "available").length;
  const totals = {
    provider: "AirLabs" as const,
    status: currentAggregate.status,
    windowStart: startsAt.toISOString(),
    windowEnd: endsAt.toISOString(),
    pastWindowStart: pastStartsAt.toISOString(),
    pastWindowEnd: pastEndsAt.toISOString(),
    totalAirports: insights.length,
    availableAirports,
    unavailableAirports: insights.length - availableAirports,
    totalFlights: currentAggregate.totalFlights,
    delayedFlights: currentAggregate.delayedFlights,
    cancelledFlights: currentAggregate.cancelledFlights,
    affectedFlights: currentAggregate.affectedFlights,
    affectedAirports: insights.filter((item) => item.current.affectedFlights > 0).length,
    affectedRoutes: insights.filter((item) => item.current.affectedFlights > 0).length,
    delayRate: currentAggregate.delayRate,
    cancellationRate: currentAggregate.cancellationRate,
    past6Status: pastAggregate.status,
    past6TotalFlights: pastAggregate.totalFlights,
    past6DelayedFlights: pastAggregate.delayedFlights,
    past6CancelledFlights: pastAggregate.cancelledFlights,
    past6AffectedFlights: pastAggregate.affectedFlights,
    trend: operationalTrend(currentAggregate, pastAggregate),
    unavailableReason:
      currentAggregate.status === "unavailable" ? currentAggregate.unavailableReason : undefined
  };

  const ranking = args.hours.flatMap((hour) => {
    const bucketFlights = findBucketFlights(args.originFlights, hour);
    return [...routeCounts(bucketFlights).entries()].map(([airportIata, value]) => {
      const startsAt = new Date(hour.startsAt);
      const endsAt = new Date(hour.endsAt);
      const stats = buildOperationalWindowStats({
        raw: args.airLabsByIata.get(airportIata),
        startsAt,
        endsAt
      });
      const weather = weatherForRanking(
        weatherByIata.get(airportIata),
        startsAt,
        endsAt,
        hour.hourOffset === 0
      );
      const risk = riskLevel({
        stats,
        weatherTone: weather.tone,
        visibilityKm: weather.visibilityKm
      });
      return {
        id: `${hour.hourOffset}-${airportIata}`,
        hourOffset: hour.hourOffset,
        startsAt: hour.startsAt,
        endsAt: hour.endsAt,
        airportIata,
        airport: value.airport,
        route: `${airportIata} → HKG`,
        flightCount: value.arrivalCount,
        totalFlights: stats.totalFlights,
        delayedFlights: stats.delayedFlights,
        cancelledFlights: stats.cancelledFlights,
        affectedFlights: stats.affectedFlights,
        delayRate: stats.delayRate,
        cancellationRate: stats.cancellationRate,
        visibilityLabel: weather.visibilityLabel,
        visibilityKm: weather.visibilityKm,
        weatherCodes: weather.weatherCodes,
        riskLevel: risk.level,
        riskReasons: risk.reasons
      };
    });
  });

  const riskRank: Record<OperationalRiskLevel, number> = {
    high: 0,
    medium: 1,
    low: 2,
    unavailable: 3
  };

  return {
    arrivalOriginOperationalInsights: insights,
    operationalTotals: totals,
    hourlyRouteAirportRanking: ranking.sort(
      (a, b) =>
        riskRank[a.riskLevel] - riskRank[b.riskLevel] ||
        b.affectedFlights - a.affectedFlights ||
        b.flightCount - a.flightCount ||
        a.airportIata.localeCompare(b.airportIata)
    )
  };
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

function formatTafWind(period: WeatherForecastPeriod, maxGust: number): string {
  if (period.windDirectionDeg === null || period.windSpeedKt === null) {
    return "wind --";
  }

  const direction =
    typeof period.windDirectionDeg === "number"
      ? String(period.windDirectionDeg).padStart(3, "0")
      : period.windDirectionDeg;
  const gust = maxGust >= 1 ? `G${maxGust}` : "";
  return `${direction}/${period.windSpeedKt}${gust}kt`;
}

function formatTafClouds(period: WeatherForecastPeriod): string {
  const clouds = [...period.clouds]
    .sort((a, b) => (a.baseFt ?? Number.MAX_SAFE_INTEGER) - (b.baseFt ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 2)
    .map((cloud) => {
      if (!cloud.cover) {
        return "";
      }
      const base =
        cloud.baseFt === null ? "" : String(Math.round(cloud.baseFt / 100)).padStart(3, "0");
      return `${cloud.cover}${base}${cloud.type ?? ""}`;
    })
    .filter(Boolean);
  return clouds.length > 0 ? clouds.join("/") : "cloud --";
}

function tafTimelineCell(args: {
  weather: AirportWeather | undefined;
  hour: DashboardData["hours"][number];
}): RouteAirportTafCell {
  const base = {
    hourOffset: args.hour.hourOffset,
    startsAt: args.hour.startsAt,
    endsAt: args.hour.endsAt,
    weatherCodes: [],
    changeIndicator: null,
    probability: null
  };

  if (!args.weather || !args.weather.tafQueried) {
    return {
      ...base,
      tone: "not-queried",
      summary: "Not queried",
      details: ["TAF was not queried for this airport."]
    };
  }

  const startsAt = new Date(args.hour.startsAt);
  const endsAt = new Date(args.hour.endsAt);
  const overlapping = args.weather.tafPeriods.filter((period) =>
    overlaps(period, startsAt, endsAt)
  );

  if (overlapping.length === 0) {
    return {
      ...base,
      tone: "no-data",
      summary: "NO DATA",
      details: ["No structured TAF forecast period overlaps this hour."]
    };
  }

  const assessment = tafWeatherAt(args.weather, startsAt, endsAt);
  const primary = [...overlapping].sort(
    (a, b) =>
      tafChangePriority(a) - tafChangePriority(b) ||
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  )[0];
  const maxGust = Math.max(0, ...overlapping.map((period) => period.windGustKt ?? 0));
  const changeIndicator = primary.changeIndicator?.toUpperCase() ?? "BASE";
  const probabilityLabel =
    primary.probability === null || primary.probability === undefined
      ? null
      : `PROB${primary.probability}`;
  const changeParts = [
    changeIndicator,
    probabilityLabel && probabilityLabel !== changeIndicator ? probabilityLabel : null
  ].filter((part): part is string => Boolean(part));
  const weatherLabel =
    assessment.category === "reported" && assessment.weatherCodes.length > 0
      ? assessment.weatherCodes.slice(0, 2).join("/")
      : "NSW";
  const windLabel = formatTafWind(primary, maxGust);
  const visibilityLabel = formatVisibility(primary.visibility);
  const cloudLabel = formatTafClouds(primary);
  const tone = assessment.category === "reported" || maxGust >= 30 ? "concern" : "normal";
  const summary = [
    changeParts.join(" "),
    weatherLabel,
    windLabel,
    visibilityLabel,
    cloudLabel
  ].join("\n");

  return {
    ...base,
    tone,
    summary,
    details: [
      `Period ${primary.startsAt} to ${primary.endsAt}`,
      `Weather ${weatherLabel}`,
      `Wind ${windLabel}`,
      `Visibility ${visibilityLabel}`,
      `Cloud ${cloudLabel}`
    ],
    weatherCodes: assessment.weatherCodes,
    changeIndicator: primary.changeIndicator,
    probability: primary.probability
  };
}

export function buildRouteAirportTafTimelines(args: {
  flights: NormalizedFlight[];
  weather: AirportWeather[];
  now: Date;
  horizonHours: DashboardOptions["horizonHours"];
  direction: DashboardOptions["direction"];
}): RouteAirportTafTimeline[] {
  const hours = buildHourlyBuckets(args.now, args.horizonHours);
  const weatherByIata = getWeatherByIata(args.weather);
  const scoped = currentWindowFlights(args);

  return [...routeCounts(scoped).entries()]
    .map(([airportIata, value]) => {
      const airportWeather = weatherByIata.get(airportIata);
      if (!airportWeather?.tafQueried) {
        return null;
      }

      return {
        airportIata,
        airport: value.airport,
        flightCount: value.count,
        arrivalCount: value.arrivalCount,
        departureCount: value.departureCount,
        rawTaf: airportWeather.rawTaf,
        issuedAt: airportWeather.tafIssuedAt,
        cells: hours.map((hour) => tafTimelineCell({ weather: airportWeather, hour }))
      };
    })
    .filter((timeline): timeline is RouteAirportTafTimeline => Boolean(timeline))
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
  const selectedWindowFlights = currentWindowFlights({
    flights,
    now,
    horizonHours: options.horizonHours,
    direction: options.direction
  });
  const originArrivalFlights = currentWindowFlights({
    flights,
    now,
    horizonHours: options.horizonHours,
    direction: "arrival"
  });
  const weatherQueryFlights = [
    ...new Map(
      [...selectedWindowFlights, ...originArrivalFlights].map((flight) => [flight.id, flight])
    ).values()
  ];
  const weatherQueryAirports = prioritizeAirportsForWeather(weatherQueryFlights, airports);
  if (airports.length > weatherQueryAirports.length) {
    warnings.push(
      `Weather lookup covered ${weatherQueryAirports.length} airports selected by current-window traffic out of ${airports.length} mapped airports loaded for the wider internal data window; flight totals still include every selected-window route airport.`
    );
  }
  const arrivalOriginAirports = [
    ...routeCounts(originArrivalFlights).values()
  ]
    .map((value) => value.airport)
    .filter((airport): airport is AirportMetadata => Boolean(airport));
  const [weather, airLabsByIata] = await Promise.all([
    fetchWeatherForAirports(weatherQueryAirports, warnings),
    fetchAirLabsAirportOperationalData({
      airports: arrivalOriginAirports,
      warnings,
      delayThresholdMinutes: OPERATIONAL_DELAY_THRESHOLD_MINUTES
    })
  ]);
  const hourly = buildHourlyArrivalTable({
    flights,
    weather,
    now,
    horizonHours: options.horizonHours,
    direction: options.direction
  });
  const situation = buildFlightSituationTable({ flights, weather, now });
  const operational = buildOperationalDashboardData({
    originFlights: originArrivalFlights,
    weather,
    airLabsByIata,
    now,
    hours: hourly.hours
  });
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
    routeAirportTafTimelines: buildRouteAirportTafTimelines({
      flights,
      weather,
      now,
      horizonHours: options.horizonHours,
      direction: options.direction
    }),
    ...operational,
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
