import { getAirport } from "./airports";
import { distanceKm, greatCircleRoute, HKG_AIRPORT } from "./geo";
import { addDays, getHongKongDateString, parseHkiaDateTime } from "./time";
import type {
  ArrivalStatus,
  FlightDirection,
  NormalizedFlight,
  TrafficType
} from "./types";

interface HkiaFlightCode {
  no?: string;
  airline?: string;
}

interface HkiaFlightItem {
  time?: string;
  flight?: HkiaFlightCode[];
  status?: string;
  statusCode?: string | null;
  origin?: string[];
  destination?: string[];
}

interface HkiaFlightDay {
  date?: string;
  list?: HkiaFlightItem[];
  lastUpdatedTime?: string;
}

const HKIA_FLIGHTS_URL =
  "https://www.hongkongairport.com/flightinfo-rest/rest/flights";
const CRUISE_SPEED_KMH = 820;
const AIRBORNE_BUFFER_HOURS = 0.55;

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

async function fetchHkiaJson(
  date: string,
  direction: FlightDirection,
  trafficType: TrafficType
): Promise<HkiaFlightDay[]> {
  const url = new URL(HKIA_FLIGHTS_URL);
  url.searchParams.set("span", "1");
  url.searchParams.set("date", date);
  url.searchParams.set("lang", "en");
  url.searchParams.set("cargo", trafficType === "cargo" ? "true" : "false");
  url.searchParams.set("arrival", direction === "arrival" ? "true" : "false");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "HKO-Flight-Weather-Dashboard/0.1"
      }
    });
    if (!response.ok) {
      throw new Error(`HKIA ${response.status}`);
    }
    return (await response.json()) as HkiaFlightDay[];
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeItem(args: {
  item: HkiaFlightItem;
  day: HkiaFlightDay;
  direction: FlightDirection;
  trafficType: TrafficType;
  now: Date;
}): NormalizedFlight | undefined {
  const date = args.day.date;
  const time = args.item.time;
  if (!date || !time) {
    return undefined;
  }

  const routeAirportIata =
    args.direction === "arrival"
      ? args.item.origin?.[0]?.toUpperCase()
      : args.item.destination?.[0]?.toUpperCase();

  if (!routeAirportIata || routeAirportIata === "HKG") {
    return undefined;
  }

  const scheduled = parseHkiaDateTime(date, time);
  const airport = getAirport(routeAirportIata);
  const route =
    airport && args.direction === "arrival"
      ? greatCircleRoute(airport, HKG_AIRPORT)
      : airport
        ? greatCircleRoute(HKG_AIRPORT, airport)
        : [];
  const routeDistance = airport ? distanceKm(airport, HKG_AIRPORT) : undefined;
  const flightNumbers = args.item.flight?.map((flight) => flight.no ?? "").filter(Boolean) ?? [];
  const airlineCodes =
    args.item.flight?.map((flight) => flight.airline ?? "").filter(Boolean) ?? [];

  return {
    id: [
      args.direction,
      args.trafficType,
      scheduled.toISOString(),
      routeAirportIata,
      flightNumbers.join("/")
    ].join("|"),
    flightNumbers,
    airlineCodes,
    scheduledTime: scheduled.toISOString(),
    direction: args.direction,
    trafficType: args.trafficType,
    routeAirportIata,
    routeAirport: airport,
    region: airport?.region ?? "Other",
    statusText: args.item.status,
    statusCode: args.item.statusCode,
    arrivalStatus:
      args.direction === "arrival" && routeDistance
        ? estimateArrivalStatus(args.now, scheduled, routeDistance)
        : undefined,
    distanceKm: routeDistance,
    route
  };
}

export async function fetchHkiaFlights(args: {
  directions: FlightDirection[];
  trafficTypes: TrafficType[];
  now: Date;
  warnings: string[];
}): Promise<{ flights: NormalizedFlight[]; sourceUpdatedAt?: string }> {
  const today = getHongKongDateString(args.now);
  const dates = [today, addDays(today, 1)];
  const seen = new Set<string>();
  const flights: NormalizedFlight[] = [];
  let sourceUpdatedAt: string | undefined;
  const jobs = args.directions.flatMap((direction) =>
    args.trafficTypes.flatMap((trafficType) =>
      dates.map(async (date) => {
        try {
          return {
            direction,
            trafficType,
            days: await fetchHkiaJson(date, direction, trafficType)
          };
        } catch (error) {
          return {
            direction,
            trafficType,
            days: [],
            warning: `HKIA ${direction}/${trafficType}/${date} unavailable: ${String(error)}`
          };
        }
      })
    )
  );

  const results = await Promise.all(jobs);

  for (const result of results) {
    if (result.warning) {
      args.warnings.push(result.warning);
    }
    for (const day of result.days) {
      if (day.lastUpdatedTime && (!sourceUpdatedAt || day.lastUpdatedTime > sourceUpdatedAt)) {
        sourceUpdatedAt = day.lastUpdatedTime;
      }
      for (const item of day.list ?? []) {
        const normalized = normalizeItem({
          item,
          day,
          direction: result.direction,
          trafficType: result.trafficType,
          now: args.now
        });
        if (normalized && !seen.has(normalized.id)) {
          seen.add(normalized.id);
          flights.push(normalized);
        }
      }
    }
  }

  return {
    flights: flights.sort(
      (a, b) =>
        new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
    ),
    sourceUpdatedAt
  };
}
