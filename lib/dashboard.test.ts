import { describe, expect, it } from "vitest";
import { getAirport } from "./airports";
import { greatCircleRoute, HKG_AIRPORT } from "./geo";
import {
  buildFlightSituationTable,
  buildHourlyArrivalTable,
  buildRouteAirportSummaries,
  buildRouteWeatherMatches,
  parseDashboardOptions
} from "./dashboard";
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
      reportType: "METAR",
      windGustKt: null
    },
    tafPeriods: [
      {
        startsAt: "2026-06-29T04:00:00.000Z",
        endsAt: "2026-06-29T20:00:00.000Z",
        probability: null,
        category: "none",
        label: "NO REPORTED WX",
        reasons: ["No encoded weather group in source data"],
        weatherCodes: [],
        changeIndicator: null,
        windGustKt: null
      }
    ],
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
        changeIndicator: null,
        windGustKt: null
      }
    ],
    rawMetar: null,
    rawTaf: "TAF RCTP 290400Z 2904/2910 09012KT 4000 TSRA BKN012",
    observedAt: "2026-06-29T04:00:00.000Z"
  }
];

describe("dashboard aggregation", () => {
  it("builds a compact hourly table with flight count, METAR, and TAF rows", () => {
    const result = buildHourlyArrivalTable({
      flights: [flight({ distanceKm: 805 })],
      weather,
      now,
      horizonHours: 12,
      direction: "arrival"
    });

    expect(result.hours).toHaveLength(12);
    expect(result.hours[0].label).toBe("Now-+1h");
    expect(result.rows.map((row) => row.id)).toEqual(["flight-rate", "metar", "taf"]);
    expect(result.rows.find((row) => row.id === "flight-rate")?.values[0]).toBe(1);
    expect(result.rows.find((row) => row.id === "metar")?.values[0]).toBe("NO DATA");
    expect(result.rows.find((row) => row.id === "taf")?.values[0]).toContain("TPE");
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
      horizonHours: 12,
      direction: "both"
    });

    expect(result.rows.find((row) => row.id === "flight-rate")?.label).toBe(
      "selected-window inbound + outbound flight count"
    );
    expect(result.rows.find((row) => row.id === "flight-rate")?.values[0]).toBe(2);
  });

  it("uses exactly the selected horizon without an extra snapshot column", () => {
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

    expect(result.hours).toHaveLength(30);
    expect(result.hours.at(-1)?.label).toBe("+29h-+30h");
    expect(options.horizonHours).toBe(30);
  });

  it("defaults to 12 hours and falls back from removed 15 hour requests", () => {
    expect(parseDashboardOptions(new URL("https://example.test/api/dashboard")).horizonHours).toBe(
      12
    );
    expect(
      parseDashboardOptions(new URL("https://example.test/api/dashboard?horizonHours=15"))
        .horizonHours
    ).toBe(12);
  });

  it("summarizes all current-window route airports and separates not-queried weather", () => {
    const nrt = getAirport("NRT")!;
    const summaries = buildRouteAirportSummaries({
      flights: [
        flight({ id: "arrival", direction: "arrival", routeAirportIata: "TPE" }),
        flight({
          id: "departure",
          direction: "departure",
          routeAirportIata: "NRT",
          routeAirport: nrt,
          region: nrt.region,
          route: greatCircleRoute(HKG_AIRPORT, nrt)
        })
      ],
      weather,
      now,
      horizonHours: 12,
      direction: "both"
    });

    expect(summaries.map((summary) => summary.airportIata)).toEqual(["NRT", "TPE"]);
    expect(summaries.find((summary) => summary.airportIata === "TPE")?.weatherStatus).toBe("taf");
    expect(summaries.find((summary) => summary.airportIata === "NRT")?.weatherStatus).toBe(
      "not-queried"
    );
  });

  it("matches route-airport weather only when METAR or TAF applies inside the selected window", () => {
    const matches = buildRouteWeatherMatches({
      flights: [flight({ scheduledTime: "2026-06-29T12:30:00.000+08:00" })],
      weather,
      now,
      horizonHours: 12,
      direction: "arrival"
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      airportIata: "TPE",
      flightCount: 1,
      sources: [expect.objectContaining({ kind: "TAF", weatherCodes: ["TSRA"] })]
    });

    const delayedWeather: AirportWeather[] = weather.map((risk) =>
      risk.airportIata === "TPE"
        ? {
            ...risk,
            tafPeriods: risk.tafPeriods.map((period) => ({
              ...period,
              startsAt: "2026-06-30T14:00:00.000Z",
              endsAt: "2026-06-30T16:00:00.000Z"
            }))
          }
        : risk
    );

    expect(
      buildRouteWeatherMatches({
        flights: [flight({ scheduledTime: "2026-06-29T12:30:00.000+08:00" })],
        weather: delayedWeather,
        now,
        horizonHours: 12,
        direction: "arrival"
      })
    ).toHaveLength(0);
  });

  it("builds the fixed +15 arrival situation table with in-air, on-land, and within-100km rows", () => {
    const result = buildFlightSituationTable({
      flights: [
        flight({ id: "en-route", scheduledTime: "2026-06-29T12:30:00.000+08:00" }),
        flight({ id: "within-100km", scheduledTime: "2026-06-29T12:05:00.000+08:00" }),
        flight({ id: "on-land", scheduledTime: "2026-06-29T16:00:00.000+08:00" }),
        flight({ id: "departure", direction: "departure", scheduledTime: "2026-06-29T12:30:00.000+08:00" })
      ],
      weather,
      now
    });

    expect(result.hours).toHaveLength(16);
    expect(result.hours.map((hour) => hour.label).slice(0, 4)).toEqual([
      "T(now)",
      "+1",
      "+2",
      "+3"
    ]);
    expect(result.rows.find((row) => row.id === "predicted-arrival-rate")?.values[0]).toBe(2);
    expect(result.rows.find((row) => row.id === "Greater China-en-route")?.values[0]).toBe(1);
    expect(result.rows.find((row) => row.id === "Greater China-within-100km")?.values[0]).toBe(1);
    expect(result.rows.find((row) => row.id === "Greater China-on-land")?.values[0]).toBe(1);
  });

  it("derives deep convection cells from METAR now and TAF future periods", () => {
    const convectiveWeather: AirportWeather[] = weather.map((risk) =>
      risk.airportIata === "HKG"
        ? {
            ...risk,
            metar: {
              category: "reported",
              label: "REPORTED WX",
              reasons: ["TSRA: thunderstorms (TS), rain (RA)"],
              weatherCodes: ["TSRA"],
              observedAt: "2026-06-29T04:00:00.000Z",
              reportType: "METAR",
              windGustKt: 31
            },
            tafPeriods: [
              {
                startsAt: "2026-06-29T05:00:00.000Z",
                endsAt: "2026-06-29T07:00:00.000Z",
                probability: null,
                category: "reported",
                label: "REPORTED WX",
                reasons: ["+SHRA: heavy (+), showers (SH), rain (RA)", "TEMPO"],
                weatherCodes: ["+SHRA"],
                changeIndicator: "TEMPO",
                windGustKt: 35
              }
            ]
          }
        : risk
    );
    const result = buildFlightSituationTable({
      flights: [],
      weather: convectiveWeather,
      now
    });
    const convection = result.rows.find((row) => row.id === "deep-convection");

    expect(convection?.values[0]).toContain("TSRA");
    expect(convection?.tones?.[0]).toBe("caution");
    expect(convection?.values[1]).toContain("+SHRA");
    expect(convection?.tones?.[1]).toBe("alert");
  });
});
