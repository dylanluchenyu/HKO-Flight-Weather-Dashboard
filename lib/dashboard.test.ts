import { describe, expect, it } from "vitest";
import { getAirport } from "./airports";
import { greatCircleRoute, HKG_AIRPORT } from "./geo";
import { buildHorizonSummaries, buildHourlyArrivalTable, parseDashboardOptions } from "./dashboard";
import type { AirportWeather, NormalizedFlight } from "./types";

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
    statusNow: overrides.statusNow ?? "unknown",
    distanceKm: overrides.distanceKm ?? 805,
    route: greatCircleRoute(airport, HKG_AIRPORT),
    ...overrides
  };
}

const weather: AirportWeather[] = [
  {
    airportIata: "HKG",
    airportIcao: "VHHH",
    category: "none",
    label: "NO REPORTED WX",
    reasons: ["No encoded weather group in source data"],
    weatherCodes: [],
    metar: {
      category: "none",
      label: "NO REPORTED WX",
      reasons: ["No encoded weather group in source data"],
      weatherCodes: [],
      observedAt: "2026-06-29T04:00:00.000Z",
      reportType: "METAR"
    },
    tafPeriods: [],
    rawMetar: "VHHH 290400Z 09010KT CAVOK",
    rawTaf: null,
    observedAt: "2026-06-29T04:00:00.000Z"
  },
  {
    airportIata: "TPE",
    airportIcao: "RCTP",
    category: "reported",
    label: "REPORTED WX",
    reasons: ["TSRA: thunderstorms (TS), rain (RA)"],
    weatherCodes: ["TSRA"],
    metar: null,
    tafPeriods: [
      {
        startsAt: "2026-06-29T04:00:00.000Z",
        endsAt: "2026-06-29T10:00:00.000Z",
        probability: null,
        category: "reported",
        label: "REPORTED WX",
        reasons: ["TSRA: thunderstorms (TS), rain (RA)"],
        weatherCodes: ["TSRA"],
        changeIndicator: null
      }
    ],
    rawMetar: null,
    rawTaf: "TAF RCTP 290400Z 2904/2910 09012KT 4000 TSRA BKN012",
    observedAt: "2026-06-29T04:00:00.000Z"
  }
];

describe("dashboard aggregation", () => {
  it("buckets arrival rate and region/status counts by hour", () => {
    const result = buildHourlyArrivalTable({
      flights: [flight({ distanceKm: 805 })],
      weather,
      now,
      horizonHours: 15,
      direction: "arrival"
    });

    expect(result.hours).toHaveLength(16);
    expect(result.rows.find((row) => row.id === "flight-rate")?.values[0]).toBe(1);
    expect(result.rows.find((row) => row.id === "Greater China-enRoute")?.values[0]).toBe(1);
    expect(result.rows.findIndex((row) => row.id === "taf")).toBeLessThan(
      result.rows.findIndex((row) => row.id === "reported-weather")
    );
    expect(result.rows.find((row) => row.id === "taf")?.values[0]).toContain("TPE");
    expect(result.rows.find((row) => row.id === "reported-weather")?.values[0]).toContain("TPE");
  });

  it("includes arrivals and departures when both directions are selected", () => {
    const nrt = getAirport("NRT")!;
    const result = buildHourlyArrivalTable({
      flights: [
        flight({ id: "arrival", direction: "arrival", routeAirportIata: "TPE" }),
        flight({
          id: "departure",
          direction: "departure",
          routeAirportIata: "NRT",
          routeAirport: nrt,
          region: nrt.region,
          statusNow: "onGround",
          route: greatCircleRoute(HKG_AIRPORT, nrt)
        })
      ],
      weather,
      now,
      horizonHours: 15,
      direction: "both"
    });

    expect(result.rows.find((row) => row.id === "flight-rate")?.label).toBe(
      "predicted arrival + departure rate"
    );
    expect(result.rows.find((row) => row.id === "flight-rate")?.values[0]).toBe(2);
    expect(result.rows.find((row) => row.id === "Asia-onGround")?.values[0]).toBe(1);
  });

  it("uses point-in-time snapshots instead of scheduled-hour membership for region rows", () => {
    const result = buildHourlyArrivalTable({
      flights: [
        flight({
          id: "later-arrival",
          scheduledTime: "2026-06-29T15:00:00.000+08:00",
          distanceKm: 3000
        })
      ],
      weather,
      now,
      horizonHours: 6,
      direction: "arrival"
    });

    expect(result.rows.find((row) => row.id === "flight-rate")?.values[0]).toBe(0);
    expect(result.rows.find((row) => row.id === "Greater China-enRoute")?.values[0]).toBe(1);
  });

  it("keeps missing-distance flights explicit in an unknown status row", () => {
    const result = buildHourlyArrivalTable({
      flights: [flight({ distanceKm: null })],
      weather,
      now,
      horizonHours: 6,
      direction: "arrival"
    });

    expect(result.rows.find((row) => row.id === "Greater China-unknown")?.values[0]).toBe(1);
  });

  it("accepts a next 30 hour table horizon", () => {
    const result = buildHourlyArrivalTable({
      flights: [],
      weather,
      now,
      horizonHours: 30,
      direction: "both"
    });
    const options = parseDashboardOptions(
      new URL("https://example.test/api/dashboard?horizonHours=30&direction=both")
    );

    expect(result.hours).toHaveLength(31);
    expect(options.horizonHours).toBe(30);
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

    expect(summaries).toHaveLength(5);
    expect(summaries[0].arrivalOrigins[0].airportIata).toBe("TPE");
    expect(summaries[0].departureDestinations[0].airportIata).toBe("NRT");
    expect(summaries[0].reportedWeatherAirports[0].airportIata).toBe("TPE");
    expect(summaries.at(-1)?.hours).toBe(30);
  });

  it("matches bad-weather flights only when the TAF period overlaps flight time", () => {
    const delayedWeather: AirportWeather[] = weather.map((risk) =>
      risk.airportIata === "TPE"
        ? {
            ...risk,
            tafPeriods: risk.tafPeriods.map((period) => ({
              ...period,
              startsAt: "2026-06-29T14:00:00.000Z",
              endsAt: "2026-06-29T16:00:00.000Z"
            }))
          }
        : risk
    );
    const summaries = buildHorizonSummaries({
      flights: [flight({ scheduledTime: "2026-06-29T12:30:00.000+08:00" })],
      weather: delayedWeather,
      now
    });

    expect(summaries[0].reportedWeatherAirports).toHaveLength(0);
  });
});
