import type {
  AirportMetadata,
  AirportWeather,
  WeatherAssessment,
  WeatherCategory,
  WeatherForecastPeriod
} from "./types";

interface NoaaMetar {
  icaoId?: string;
  rawOb?: string;
  obsTime?: string | number;
  metarType?: string;
  wxString?: string | null;
  wgst?: number | null;
  visib?: string | number | null;
  clouds?: NoaaCloudLayer[];
}

interface NoaaTafForecast {
  timeFrom?: string | number;
  timeTo?: string | number;
  fcstChange?: string | null;
  probability?: number | null;
  wxString?: string | null;
  wdir?: number | string | null;
  wspd?: number | null;
  wgst?: number | null;
  visib?: string | number | null;
  clouds?: NoaaCloudLayer[];
}

interface NoaaCloudLayer {
  cover?: string | null;
  base?: number | null;
  type?: string | null;
}

interface NoaaTaf {
  icaoId?: string;
  rawTAF?: string;
  rawOb?: string;
  issueTime?: string | number;
  fcsts?: NoaaTafForecast[];
}

// Meanings below are taken directly from the HKO METAR/SPECI and TAF decoding
// guides. Unknown codes remain visible verbatim instead of being reclassified.
const HKO_CODE_MEANINGS: Record<string, string> = {
  MI: "shallow",
  BC: "patches",
  SH: "showers",
  PR: "partial",
  TS: "thunderstorms",
  DZ: "drizzle",
  RA: "rain",
  BR: "mist",
  FG: "fog",
  HZ: "haze"
};
const HKO_CODES = Object.keys(HKO_CODE_MEANINGS).sort((a, b) => b.length - a.length);

function categoryRank(category: WeatherCategory): number {
  return { unknown: 0, none: 1, reported: 2 }[category];
}

export function mergeWeatherCategory(
  current: WeatherCategory,
  candidate: WeatherCategory
): WeatherCategory {
  return categoryRank(candidate) > categoryRank(current) ? candidate : current;
}

export function describeWeatherCategory(category: WeatherCategory): string {
  if (category === "unknown") {
    return "NO DATA";
  }
  if (category === "none") {
    return "NO REPORTED WX";
  }
  return "REPORTED WX";
}

function toIso(value?: string | number): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const date =
    typeof value === "number"
      ? new Date(value < 10_000_000_000 ? value * 1000 : value)
      : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toWindGustKt(value?: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toWindDirection(value?: number | string | null): number | string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim().toUpperCase();
  }
  return null;
}

function toWindSpeedKt(value?: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeClouds(clouds?: NoaaCloudLayer[]) {
  return (clouds ?? []).map((cloud) => ({
    cover: cloud.cover?.toUpperCase() ?? null,
    baseFt: typeof cloud.base === "number" && Number.isFinite(cloud.base) ? cloud.base : null,
    type: cloud.type?.toUpperCase() ?? null
  }));
}

function decodeWeatherGroup(rawGroup: string): string {
  let group = rawGroup.toUpperCase();
  const details: string[] = [];

  if (group.startsWith("-")) {
    details.push("light (-)");
    group = group.slice(1);
  } else if (group.startsWith("+")) {
    details.push("heavy (+)");
    group = group.slice(1);
  }

  if (group.startsWith("VC")) {
    details.push("vicinity (VC)");
    group = group.slice(2);
  }

  while (group.length >= 2) {
    const code = HKO_CODES.find((candidate) => group.startsWith(candidate));
    if (!code) {
      break;
    }
    details.push(`${HKO_CODE_MEANINGS[code]} (${code})`);
    group = group.slice(code.length);
  }

  if (group) {
    details.push(`unexpanded code ${group}`);
  }
  return details.length > 0
    ? `${rawGroup.toUpperCase()}: ${details.join(", ")}`
    : `${rawGroup.toUpperCase()}: reported weather code`;
}

function assessEncodedWeather(wxString?: string | null): WeatherAssessment {
  if (wxString === undefined || wxString === null || wxString.trim() === "") {
    return {
      category: "none",
      label: describeWeatherCategory("none"),
      reasons: ["No encoded weather group in source data"],
      weatherCodes: []
    };
  }

  const groups = wxString.toUpperCase().trim().split(/\s+/).filter(Boolean);
  const reportedGroups = groups.filter((group) => group !== "NSW");
  if (reportedGroups.length === 0) {
    return {
      category: "none",
      label: describeWeatherCategory("none"),
      reasons: ["NSW: nil significant weather"],
      weatherCodes: groups
    };
  }

  return {
    category: "reported",
    label: describeWeatherCategory("reported"),
    reasons: reportedGroups.map(decodeWeatherGroup),
    weatherCodes: reportedGroups
  };
}

function unavailableAssessment(): WeatherAssessment {
  return {
    category: "unknown",
    label: describeWeatherCategory("unknown"),
    reasons: ["Weather data unavailable"],
    weatherCodes: []
  };
}

function combineAssessments(assessments: WeatherAssessment[]): WeatherAssessment {
  if (assessments.length === 0) {
    return unavailableAssessment();
  }

  let category: WeatherCategory = "unknown";
  for (const assessment of assessments) {
    category = mergeWeatherCategory(category, assessment.category);
  }
  const selected = assessments.filter((assessment) => assessment.category === category);
  return {
    category,
    label: describeWeatherCategory(category),
    reasons: [...new Set(selected.flatMap((assessment) => assessment.reasons))],
    weatherCodes: [...new Set(selected.flatMap((assessment) => assessment.weatherCodes))]
  };
}

export function normalizeAirportWeather(args: {
  airportIata: string;
  airportIcao: string;
  metar?: NoaaMetar;
  taf?: NoaaTaf;
  tafQueried?: boolean;
}): AirportWeather {
  const metarAssessment = args.metar
    ? assessEncodedWeather(args.metar.wxString)
    : null;

  const tafPeriods = (args.taf?.fcsts ?? []).flatMap<WeatherForecastPeriod>((forecast) => {
    const startsAt = toIso(forecast.timeFrom);
    const endsAt = toIso(forecast.timeTo);
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
      return [];
    }
    const assessment = assessEncodedWeather(forecast.wxString);
    const sourceNotes = [
      forecast.fcstChange ?? null,
      forecast.probability === null || forecast.probability === undefined
        ? null
        : `PROB${forecast.probability}`
    ].filter((value): value is string => Boolean(value));
    return [
      {
        ...assessment,
        reasons: [...assessment.reasons, ...sourceNotes],
        startsAt,
        endsAt,
        probability: forecast.probability ?? null,
        changeIndicator: forecast.fcstChange ?? null,
        windDirectionDeg: toWindDirection(forecast.wdir),
        windSpeedKt: toWindSpeedKt(forecast.wspd),
        windGustKt: toWindGustKt(forecast.wgst),
        visibility:
          forecast.visib === undefined || forecast.visib === null ? null : String(forecast.visib),
        clouds: normalizeClouds(forecast.clouds)
      }
    ];
  });

  const overall = combineAssessments([
    ...(metarAssessment ? [metarAssessment] : []),
    ...tafPeriods
  ]);
  const observedAt = toIso(args.metar?.obsTime ?? args.taf?.issueTime);

  return {
    airportIata: args.airportIata,
    airportIcao: args.airportIcao,
    ...overall,
    metar: metarAssessment
      ? {
          ...metarAssessment,
          observedAt: toIso(args.metar?.obsTime),
          reportType: args.metar?.metarType ?? null,
          windGustKt: toWindGustKt(args.metar?.wgst),
          visibility:
            args.metar?.visib === undefined || args.metar?.visib === null
              ? null
              : String(args.metar.visib),
          clouds: normalizeClouds(args.metar?.clouds)
        }
      : null,
    tafQueried: args.tafQueried ?? Boolean(args.taf),
    tafPeriods,
    rawMetar: args.metar?.rawOb ?? null,
    rawTaf: args.taf?.rawTAF ?? args.taf?.rawOb ?? null,
    tafIssuedAt: toIso(args.taf?.issueTime),
    observedAt
  };
}

export function tafWeatherAt(
  weather: AirportWeather,
  startsAt: Date,
  endsAt: Date
): WeatherAssessment {
  const overlapping = weather.tafPeriods.filter(
    (period) => new Date(period.startsAt) < endsAt && new Date(period.endsAt) > startsAt
  );
  return combineAssessments(overlapping);
}

export function weatherAt(
  weather: AirportWeather,
  startsAt: Date,
  endsAt: Date,
  includeMetar: boolean
): WeatherAssessment {
  const assessments: WeatherAssessment[] = [];
  if (includeMetar && weather.metar) {
    assessments.push(weather.metar);
  }
  const taf = tafWeatherAt(weather, startsAt, endsAt);
  if (taf.category !== "unknown") {
    assessments.push(taf);
  }
  return combineAssessments(assessments);
}

async function fetchNoaa<T>(
  endpoint: "metar" | "taf",
  icaos: string[],
  timeoutMs = 8000
): Promise<T[]> {
  if (icaos.length === 0) {
    return [];
  }
  const url = new URL(`https://aviationweather.gov/api/data/${endpoint}`);
  url.searchParams.set("ids", icaos.join(","));
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "HKO-Flight-Weather-Dashboard/0.1"
      }
    });
    if (!response.ok) {
      throw new Error(`${endpoint.toUpperCase()} ${response.status}`);
    }
    return (await response.json()) as T[];
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchWeatherForAirports(
  airports: AirportMetadata[],
  warnings: string[]
): Promise<AirportWeather[]> {
  const icaos = [...new Set(airports.map((airport) => airport.icao))].slice(0, 90);
  if (icaos.length === 0) {
    return [];
  }

  const tafIcaos = icaos.slice(0, 45);
  if (icaos.length > tafIcaos.length) {
    warnings.push("TAF forecast lookup limited to first 45 weather-queried route airports for faster loading.");
  }

  let metars: NoaaMetar[] = [];
  let tafs: NoaaTaf[] = [];
  const [metarResult, tafResult] = await Promise.allSettled([
    fetchNoaa<NoaaMetar>("metar", icaos, 8000),
    fetchNoaa<NoaaTaf>("taf", tafIcaos, 8000)
  ]);

  if (metarResult.status === "fulfilled") {
    metars = metarResult.value;
  } else {
    warnings.push(`NOAA METAR unavailable: ${String(metarResult.reason)}`);
  }
  if (tafResult.status === "fulfilled") {
    tafs = tafResult.value;
  } else {
    warnings.push(`NOAA TAF unavailable: ${String(tafResult.reason)}`);
  }

  const metarByIcao = new Map(metars.map((metar) => [metar.icaoId, metar]));
  const tafByIcao = new Map(tafs.map((taf) => [taf.icaoId, taf]));

  return airports.map((airport) =>
    normalizeAirportWeather({
      airportIata: airport.iata,
      airportIcao: airport.icao,
      metar: metarByIcao.get(airport.icao),
      taf: tafByIcao.get(airport.icao),
      tafQueried: tafIcaos.includes(airport.icao)
    })
  );
}
