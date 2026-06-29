import type { AirportMetadata, WeatherRisk, WeatherRiskLevel } from "./types";

interface NoaaMetar {
  icaoId?: string;
  rawOb?: string;
  obsTime?: string;
  wspd?: number;
  wgst?: number;
  visib?: string | number;
  wxString?: string;
  clouds?: Array<{ cover?: string; base?: number }>;
}

interface NoaaTaf {
  icaoId?: string;
  rawTAF?: string;
  rawOb?: string;
  issueTime?: string;
}

const BAD_WEATHER_CODES = [
  "FZ",
  "GR",
  "TS",
  "SN",
  "SG",
  "IC",
  "PE",
  "GS",
  "VA",
  "DU",
  "SA",
  "PO",
  "SQ",
  "FC",
  "SS",
  "DS"
];

const SEVERE_CODES = new Set(["TS", "FZ", "SQ", "FC", "VA", "SS", "DS"]);

function riskRank(level: WeatherRiskLevel): number {
  return {
    nil: 0,
    caution: 1,
    significant: 2,
    severe: 3
  }[level];
}

export function highestRisk(
  current: WeatherRiskLevel,
  candidate: WeatherRiskLevel
): WeatherRiskLevel {
  return riskRank(candidate) > riskRank(current) ? candidate : current;
}

function parseVisibilitySm(value?: string | number): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  const clean = value.replace("+", "").trim();
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function codeRegex(code: string): RegExp {
  return new RegExp(`(^|[^A-Z])[-+A-Z]*${code}[A-Z]*($|[^A-Z])`, "i");
}

export function classifyWeatherRisk(args: {
  airportIata: string;
  airportIcao: string;
  metar?: NoaaMetar;
  taf?: NoaaTaf;
}): WeatherRisk {
  const reasons: string[] = [];
  let level: WeatherRiskLevel = "nil";
  const rawMetar = args.metar?.rawOb;
  const rawTaf = args.taf?.rawTAF ?? args.taf?.rawOb;
  const weatherText = `${args.metar?.wxString ?? ""} ${rawMetar ?? ""} ${rawTaf ?? ""}`;
  const wind = Math.max(args.metar?.wspd ?? 0, args.metar?.wgst ?? 0);
  const visibilitySm = parseVisibilitySm(args.metar?.visib);

  if (wind >= 35) {
    level = highestRisk(level, "significant");
    reasons.push(`Wind/gust ${wind} kt`);
  }

  if (visibilitySm !== undefined && visibilitySm < 0.62) {
    level = highestRisk(level, "significant");
    reasons.push(`Visibility ${visibilitySm} SM`);
  }

  const ceiling = args.metar?.clouds
    ?.filter((cloud) => ["BKN", "OVC", "VV"].includes(cloud.cover ?? ""))
    .map((cloud) => cloud.base)
    .filter((base): base is number => typeof base === "number")
    .sort((a, b) => a - b)[0];

  if (ceiling !== undefined && ceiling < 1000) {
    level = highestRisk(level, "significant");
    reasons.push(`Ceiling ${ceiling} ft`);
  }

  for (const code of BAD_WEATHER_CODES) {
    if (codeRegex(code).test(weatherText)) {
      const codeLevel = SEVERE_CODES.has(code) ? "severe" : "significant";
      level = highestRisk(level, codeLevel);
      reasons.push(`Weather code ${code}`);
    }
  }

  const tafGustMatch = rawTaf?.match(/G(\d{2,3})KT/i);
  if (tafGustMatch) {
    const gust = Number(tafGustMatch[1]);
    if (gust >= 35) {
      level = highestRisk(level, "significant");
      reasons.push(`TAF gust ${gust} kt`);
    }
  }

  if (level === "nil") {
    reasons.push("No significant criteria met");
  }

  return {
    airportIata: args.airportIata,
    airportIcao: args.airportIcao,
    level,
    label:
      level === "nil"
        ? "NIL"
        : level === "caution"
          ? "Caution"
          : level === "significant"
            ? "Significant"
            : "Severe",
    reasons: [...new Set(reasons)],
    rawMetar,
    rawTaf,
    observedAt: args.metar?.obsTime ?? args.taf?.issueTime
  };
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
): Promise<WeatherRisk[]> {
  const icaos = [...new Set(airports.map((airport) => airport.icao))].slice(0, 90);
  if (icaos.length === 0) {
    return [];
  }

  const tafIcaos = icaos.slice(0, 45);
  if (icaos.length > tafIcaos.length) {
    warnings.push("TAF forecast lookup limited to first 45 priority airports for faster loading.");
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
    classifyWeatherRisk({
      airportIata: airport.iata,
      airportIcao: airport.icao,
      metar: metarByIcao.get(airport.icao),
      taf: tafByIcao.get(airport.icao)
    })
  );
}

export function describeRisk(level: WeatherRiskLevel): string {
  if (level === "nil") {
    return "NIL";
  }
  if (level === "severe") {
    return "BAD WX";
  }
  if (level === "significant") {
    return "WX RISK";
  }
  return "WATCH";
}
