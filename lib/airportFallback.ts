import type { AirportMetadata, Region } from "./types";

const OUR_AIRPORTS_URL =
  "https://davidmegginson.github.io/ourairports-data/airports.csv";

let fallbackCache:
  | {
      fetchedAt: number;
      airports: Map<string, AirportMetadata>;
    }
  | undefined;

const CACHE_MS = 24 * 60 * 60 * 1000;
const GREATER_CHINA_CODES = new Set(["CN", "HK", "MO", "TW"]);
const MIDDLE_EAST_CODES = new Set([
  "AE",
  "BH",
  "IL",
  "IQ",
  "IR",
  "JO",
  "KW",
  "LB",
  "OM",
  "PS",
  "QA",
  "SA",
  "SY",
  "YE"
]);

export function regionFromOurAirports(continent: string, isoCountry: string): Region {
  if (GREATER_CHINA_CODES.has(isoCountry)) {
    return "Greater China";
  }
  if (MIDDLE_EAST_CODES.has(isoCountry)) {
    return "Middle East";
  }
  if (continent === "OC") {
    return "Oceania";
  }
  if (continent === "NA" || continent === "SA") {
    return "America";
  }
  if (continent === "AF") {
    return "Africa";
  }
  if (continent === "EU") {
    return "Europe";
  }
  if (continent === "AS") {
    return "Asia";
  }
  return "Other";
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function parseOurAirportsCsv(csv: string): Map<string, AirportMetadata> {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines[0]);
  const index = new Map(headers.map((header, position) => [header, position]));
  const airports = new Map<string, AirportMetadata>();

  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const get = (name: string) => values[index.get(name) ?? -1] ?? "";
    const iata = get("iata_code").toUpperCase();
    if (!iata) {
      continue;
    }

    const lat = Number(get("latitude_deg"));
    const lon = Number(get("longitude_deg"));
    const icao = (get("icao_code") || get("gps_code") || get("ident")).toUpperCase();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !/^[A-Z0-9]{4}$/.test(icao)) {
      continue;
    }

    airports.set(iata, {
      iata,
      icao,
      name: get("name") || `${iata} Airport`,
      city: get("municipality") || iata,
      country: get("iso_country") || "Unknown",
      region: regionFromOurAirports(get("continent"), get("iso_country")),
      lat,
      lon
    });
  }

  return airports;
}

async function loadFallbackAirports(warnings: string[]): Promise<Map<string, AirportMetadata>> {
  const now = Date.now();
  if (fallbackCache && now - fallbackCache.fetchedAt < CACHE_MS) {
    return fallbackCache.airports;
  }

  try {
    const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(OUR_AIRPORTS_URL, {
        signal: controller.signal,
        headers: {
          "User-Agent": "HKO-Flight-Weather-Dashboard/0.1"
        }
      });
      if (!response.ok) {
        throw new Error(`OurAirports ${response.status}`);
      }
      const airports = parseOurAirportsCsv(await response.text());
      fallbackCache = { fetchedAt: now, airports };
      return airports;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    warnings.push(`OurAirports fallback unavailable: ${String(error)}`);
    return fallbackCache?.airports ?? new Map();
  }
}

export async function fetchAirportFallbacks(
  iatas: string[],
  warnings: string[]
): Promise<Map<string, AirportMetadata>> {
  const needed = new Set(iatas.map((iata) => iata.toUpperCase()));
  const all = await loadFallbackAirports(warnings);
  return new Map([...all.entries()].filter(([iata]) => needed.has(iata)));
}
