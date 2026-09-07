import type { AirportMetadata } from "./types";

const AIRLABS_BASE_URL = "https://airlabs.co/api/v9";
const AIRLABS_DELAY_THRESHOLD_MINUTES = 30;

interface AirLabsApiResponse<T> {
  response?: T[];
  error?: {
    message?: string;
    code?: string;
  };
}

interface AirLabsScheduleItem {
  flight_iata?: string | null;
  flight_icao?: string | null;
  dep_iata?: string | null;
  arr_iata?: string | null;
  dep_time_ts?: number | null;
  arr_time_ts?: number | null;
  dep_delayed?: number | null;
  arr_delayed?: number | null;
  delayed?: number | null;
  status?: string | null;
}

interface AirLabsDelayItem {
  flight_iata?: string | null;
  flight_icao?: string | null;
  dep_iata?: string | null;
  arr_iata?: string | null;
  dep_time_ts?: number | null;
  arr_time_ts?: number | null;
  dep_delayed?: number | null;
  arr_delayed?: number | null;
  delayed?: number | null;
  status?: string | null;
}

export interface AirLabsOperationalFlight {
  flightIata: string | null;
  flightIcao: string | null;
  depIata: string | null;
  arrIata: string | null;
  depTimeTs: number | null;
  arrTimeTs: number | null;
  depDelayedMinutes: number | null;
  arrDelayedMinutes: number | null;
  delayedMinutes: number | null;
  status: string | null;
}

export interface AirLabsAirportOperationalData {
  airportIata: string;
  schedules: AirLabsOperationalFlight[];
  delays: AirLabsOperationalFlight[];
  unavailableReason?: string;
}

function normalizeFlight(
  item: AirLabsScheduleItem | AirLabsDelayItem
): AirLabsOperationalFlight {
  return {
    flightIata: item.flight_iata?.toUpperCase() ?? null,
    flightIcao: item.flight_icao?.toUpperCase() ?? null,
    depIata: item.dep_iata?.toUpperCase() ?? null,
    arrIata: item.arr_iata?.toUpperCase() ?? null,
    depTimeTs: typeof item.dep_time_ts === "number" ? item.dep_time_ts : null,
    arrTimeTs: typeof item.arr_time_ts === "number" ? item.arr_time_ts : null,
    depDelayedMinutes: typeof item.dep_delayed === "number" ? item.dep_delayed : null,
    arrDelayedMinutes: typeof item.arr_delayed === "number" ? item.arr_delayed : null,
    delayedMinutes: typeof item.delayed === "number" ? item.delayed : null,
    status: item.status ?? null
  };
}

async function fetchAirLabs<T>(
  endpoint: "schedules" | "delays",
  params: Record<string, string | number>,
  apiKey: string
): Promise<T[]> {
  const url = new URL(`${AIRLABS_BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("api_key", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "HKO-Flight-Weather-Dashboard/0.1"
      }
    });
    if (!response.ok) {
      throw new Error(`AirLabs ${endpoint} ${response.status}`);
    }
    const body = (await response.json()) as AirLabsApiResponse<T>;
    if (body.error) {
      throw new Error(body.error.message ?? body.error.code ?? `AirLabs ${endpoint} error`);
    }
    return body.response ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function fetchAirLabsAirportOperationalData(args: {
  airports: AirportMetadata[];
  warnings: string[];
  apiKey?: string;
  delayThresholdMinutes?: number;
}): Promise<Map<string, AirLabsAirportOperationalData>> {
  const result = new Map<string, AirLabsAirportOperationalData>();
  const apiKey = args.apiKey?.trim() || process.env.AIRLABS_API_KEY?.trim();
  const delayThreshold = args.delayThresholdMinutes ?? AIRLABS_DELAY_THRESHOLD_MINUTES;

  if (!apiKey) {
    for (const airport of args.airports) {
      result.set(airport.iata, {
        airportIata: airport.iata,
        schedules: [],
        delays: [],
        unavailableReason: "AirLabs access key is not configured on the server."
      });
    }
    return result;
  }

  const rows = await mapWithConcurrency(args.airports, 4, async (airport) => {
    try {
      const [schedules, delays] = await Promise.all([
        fetchAirLabs<AirLabsScheduleItem>(
          "schedules",
          {
            dep_iata: airport.iata,
            limit: 1000
          },
          apiKey
        ),
        fetchAirLabs<AirLabsDelayItem>(
          "delays",
          {
            dep_iata: airport.iata,
            type: "departures",
            delay: delayThreshold,
            limit: 1000
          },
          apiKey
        )
      ]);

      return {
        airportIata: airport.iata,
        schedules: schedules.map(normalizeFlight),
        delays: delays.map(normalizeFlight)
      };
    } catch (error) {
      const warning = `AirLabs operational data unavailable for ${airport.iata}: ${String(error)}`;
      args.warnings.push(warning);
      return {
        airportIata: airport.iata,
        schedules: [],
        delays: [],
        unavailableReason: String(error)
      };
    }
  });

  for (const row of rows) {
    result.set(row.airportIata, row);
  }
  return result;
}
