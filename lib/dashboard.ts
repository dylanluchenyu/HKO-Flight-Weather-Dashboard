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
const SIGNIFICANT_GUST_KT = 30;
const STRONG_GUST_KT = 35;
const LOW_VISIBILITY_KM = 5;
const VERY_LOW_VISIBILITY_KM = 1.5;
const LOW_CEILING_FT = 1500;
const VERY_LOW_CEILING_FT = 500;
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
  return normalized.startsWith("+") || normalized.includes("TS") || /(^|VC)(SQ|FC)/.test(normalized);
}

function isSignificantWeatherCode(code: string): boolean {
  const normalized = code.toUpperCase().trim();
  return (
    normalized.startsWith("+") ||
    /(TS|FG|SQ|FC|GR|GS|FZ|SS|DS|VA)/.test(normalized)
  );
}

function parseVisibilityKm(value: string | number | null): number | null {
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
      return (whole + numerator / denominator) * 1.609344;
    }
  }

  const fraction = normalized.match(/^(\d+)\/(\d+)/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator !== 0) {
      return (numerator / denominator) * 1.609344;
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

  return numeric > 50 ? numeric / 1000 : numeric * 1.609344;
}

function formatVisibilityKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}km`;
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
    .map((source) => parseVisibilityKm(source.visibility))
    .filter((value): value is number => value !== null);
  const lowestVisibility = visibilities.length > 0 ? Math.min(...visibilities) : null;
  const ceiling = lowestCeilingFt(sources);
  const parts = [
    ...codes.slice(0, 2),
    lowestVisibility !== null && lowestVisibility < LOW_VISIBILITY_KM
      ? `VIS ${formatVisibilityKm(lowestVisibility)}`
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
    (lowestVisibility !== null && lowestVisibility < VERY_LOW_VISIBILITY_KM) ||
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
  const visibilityLabel = primary.visibility ? `vis ${primary.visibility}` : "vis --";
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
    routeAirportTafTimelines: buildRouteAirportTafTimelines({
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
