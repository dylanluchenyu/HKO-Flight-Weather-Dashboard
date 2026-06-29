import { describe, expect, it } from "vitest";
import { getAirport } from "./airports";
import { greatCircleRoute, HKG_AIRPORT } from "./geo";
import { buildHorizonSummaries, buildHourlyArrivalTable } from "./dashboard";
import type { NormalizedFlight, WeatherRisk } from "./types";

const now = new Date("2026-06-29T12:00:00+08:00");

function flight(overrides: Partial<NormalizedFlight>): NormalizedFlight {
  const airport = getAirport(overrides.routeAirportIata ?? "TPE")!;
  return {
    id: overrides.id ?? "flight-1",
    flightNumbers: overrides.flightNumbers ?? ["CX 400"],
    airlineCodes: ["CPA"],
    scheduledTime: overrides.scheduledTime ?? "2026-06-29T12:30:00.000+08:00",
    direction: overrides.direction ?? "arrival",
    trafficType: overrides.trafficType ?? "passenger",
    routeAirportIata: airport.iata,
    routeAirport: airport,
    region: overrides.region ?? airport.region,
    statusText: "Scheduled",
    statusCode: null,
    arrivalStatus: overrides.arrivalStatus ?? "onLand",
    distanceKm: 805,
    route: greatCircleRoute(airport, HKG_AIRPORT),
    ...overrides
  };
}

const weather: WeatherRisk[] = [
  {
    airportIata: "HKG",
    airportIcao: "VHHH",
    level: "nil",
    label: "NIL",
    reasons: ["No significant criteria met"]
  },
  {
    airportIata: "TPE",
    airportIcao: "RCTP",
    level: "severe",
    label: "Severe",
    reasons: ["Weather code TS"]
  }
];

describe("dashboard aggregation", () => {
  it("buckets arrival rate and region/status counts by hour", () => {
    const result = buildHourlyArrivalTable({
      flights: [flight({ arrivalStatus: "onLand" })],
      weather,
      now,
      horizonHours: 15
    });

    expect(result.hours).toHaveLength(16);
    expect(result.rows.find((row) => row.id === "arrival-rate")?.values[0]).toBe(1);
    expect(result.rows.find((row) => row.id === "Greater China-onLand")?.values[0]).toBe(1);
    expect(result.rows.find((row) => row.id === "deep-convection-alert")?.values[0]).toContain("TPE");
  });

  it("summarizes 6/12/18/24 hour airport horizons", () => {
    const summaries = buildHorizonSummaries({
      flights: [
        flight({ id: "arrival", direction: "arrival", routeAirportIata: "TPE" }),
        flight({
          id: "departure",
          direction: "departure",
          routeAirportIata: "NRT",
          routeAirport: getAirport("NRT")!,
          region: "Asia"
        })
      ],
      weather,
      now
    });

    expect(summaries).toHaveLength(4);
    expect(summaries[0].arrivalOrigins[0].airportIata).toBe("TPE");
    expect(summaries[0].departureDestinations[0].airportIata).toBe("NRT");
    expect(summaries[0].badWeatherAirports[0].airportIata).toBe("TPE");
  });
});
