import type { AirportMetadata } from "./types";

export const FLIGHTRADAR24_DISRUPTION_URL =
  "https://www.flightradar24.com/data/airport-disruption";

export const FLIGHTRADAR24_OPERATIONAL_UNAVAILABLE_REASON =
  "Flightradar24 operational data is not connected. Its public tracking API does not provide scheduled flight times or cancellation records, so it cannot supply airport delay/cancellation rates. An authorized airport operational feed is required.";

/**
 * Provider-neutral input for a future authorized operational feed.
 * These are normalized application fields, not Flightradar24 public API fields.
 */
export interface OperationalFlight {
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

export interface AirportOperationalData {
  airportIata: string;
  schedules: OperationalFlight[];
  delays: OperationalFlight[];
  unavailableReason?: string;
}

/**
 * No network call is made here. The FR24 map is not an operational-data API,
 * and a public tracking API key does not grant access to the missing fields.
 * Keep unavailable distinct from a measured zero until an authorized feed exists.
 */
export function createUnavailableFlightradar24Data(
  airports: AirportMetadata[]
): Map<string, AirportOperationalData> {
  return new Map(
    airports.map((airport) => [
      airport.iata,
      {
        airportIata: airport.iata,
        schedules: [],
        delays: [],
        unavailableReason: FLIGHTRADAR24_OPERATIONAL_UNAVAILABLE_REASON
      }
    ])
  );
}
