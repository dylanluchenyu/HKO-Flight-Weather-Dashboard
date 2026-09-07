import { describe, expect, it, vi } from "vitest";
import { getAirport } from "./airports";
import { greatCircleRoute, HKG_AIRPORT } from "./geo";
import {
  buildFlightSituationTable,
  buildHourlyArrivalTable,
  buildOperationalDashboardData,
  buildRouteAirportTafTimelines,
  buildRouteAirportSummaries,
  buildRouteWeatherMatches,
  parseDashboardOptions,
  selectAirportsForWeather,
  formatVisibility
} from "./dashboard";
import type { AirportWeather, NormalizedFlight, WeatherForecastPeriod } from "./types";
import {
  createUnavailableFlightradar24Data,
  FLIGHTRADAR24_OPERATIONAL_UNAVAILABLE_REASON,
  type AirportOperationalData
} from "./flightradar24";

const now = new Date("2026-06-29T12:00:00+08:00");

describe("visibility presentation", () => {
  it.each([
    [1.99, "VIS 1.99 sm / 3.2 km"],
    [0, "VIS 0 sm / 0 km"],
    [5 / 1.609344, "VIS 5 km"],
    [4, "VIS 6.4 km"],
    [10 / 1.609344, "VIS 10 km"],
    [10, "VIS >10 km"],
    ["6+", "VIS >9.7 km"],
    ["P6SM", "VIS >9.7 km"],
    ["7+", "VIS >10 km"],
    ["M1/4SM", "VIS M1/4 sm / <0.4 km"],
    ["<20", "VIS <20 sm / <32.2 km"],
    ["1 1/2", "VIS 1 1/2 sm / 2.4 km"],
    ["CAVOK", "VIS ≥10 km"],
    [null, "VIS --"],
    ["unknown", "VIS --"],
    ["1/0", "VIS --"]
  ] as Array<[string | number | null, string]>)("formats %s without losing source limits", (value, expected) => {
    expect(formatVisibility(value)).toBe(expected);
  });
});

describe("weather airport selection", () => {
  it("includes every selected route airport and HKG without a priority-airport cap", () => {
    const airports = Array.from({ length: 110 }, (_, index) => ({
      ...HKG_AIRPORT,
      iata: `A${index}`,
      icao: `Z${String(index).padStart(3, "0")}`
    }));
    const flights = airports.map((airport, index) => ({
      ...flight({ id: `all-airports-${index}` }),
      routeAirportIata: airport.iata,
      routeAirport: airport
    }));
    const selected = selectAirportsForWeather(flights, [HKG_AIRPORT, ...airports]);
    expect(selected).toHaveLength(111);
    expect(selected[0].iata).toBe("HKG");
    expect(new Set(selected.map((airport) => airport.iata))).toEqual(
      new Set(["HKG", ...airports.map((airport) => airport.iata)])
    );
  });
});

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

function tafPeriod(overrides: Partial<WeatherForecastPeriod> = {}): WeatherForecastPeriod {
  return {
    startsAt: "2026-06-29T04:00:00.000Z",
    endsAt: "2026-06-29T20:00:00.000Z",
    probability: null,
    category: "none",
    label: "NO REPORTED WX",
    reasons: ["No encoded weather group in source data"],
    weatherCodes: [],
    changeIndicator: null,
    windDirectionDeg: null,
    windSpeedKt: null,
    windGustKt: null,
    visibility: null,
    clouds: [],
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
      windGustKt: null,
      visibility: null,
      clouds: []
    },
    tafQueried: true,
    tafPeriods: [tafPeriod()],
    rawMetar: "VHHH 290400Z 09010KT CAVOK",
    rawTaf: null,
    tafIssuedAt: "2026-06-29T04:00:00.000Z",
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
      tafPeriod({
        startsAt: "2026-06-29T04:00:00.000Z",
        endsAt: "2026-06-29T10:00:00.000Z",
        category: "reported",
        label: "REPORTED WX",
        reasons: ["TSRA: thunderstorms (TS), rain (RA)"],
        weatherCodes: ["TSRA"],
        windDirectionDeg: 90,
        windSpeedKt: 12,
        visibility: "4000",
        clouds: [{ cover: "BKN", baseFt: 1200, type: null }]
      })
    ],
    tafQueried: true,
    rawMetar: null,
    rawTaf: "TAF RCTP 290400Z 2904/2910 09012KT 4000 TSRA BKN012",
    tafIssuedAt: "2026-06-29T04:00:00.000Z",
    observedAt: "2026-06-29T04:00:00.000Z"
  }
];

function mockOperationalData(
  airportIata: string,
  overrides: Partial<AirportOperationalData> = {}
): AirportOperationalData {
  return {
    airportIata,
    schedules: [],
    delays: [],
    ...overrides
  };
}

function ts(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

describe("visibility threshold semantics", () => {
  const fiveKmSm = 5 / 1.609344;
  const onePointFiveKmSm = 1.5 / 1.609344;
  const cases = [
    ["P2SM", "nil", "low"],
    [">=2", "nil", "low"],
    [`<${fiveKmSm}`, "caution", "medium"],
    [`<=${fiveKmSm}`, "nil", "low"],
    [`<${onePointFiveKmSm}`, "alert", "high"],
    [`<=${onePointFiveKmSm}`, "caution", "medium"],
    [String(onePointFiveKmSm), "caution", "medium"],
    [String(fiveKmSm), "nil", "low"],
    ["M1/4SM", "alert", "high"],
    ["P1/4SM", "nil", "low"],
    ["6+", "nil", "low"],
    ["<20", "nil", "low"]
  ];

  function boundedWeather(visibility: string): AirportWeather[] {
    return ["HKG", "TPE"].map((airportIata) => ({
      ...weather[0],
      airportIata,
      airportIcao: getAirport(airportIata)!.icao,
      metar: null,
      tafPeriods: [tafPeriod({ visibility })]
    }));
  }

  it.each(cases)("keeps the bound in %s when checking significant-weather thresholds", (visibility, tone) => {
    const result = buildFlightSituationTable({ flights: [], weather: boundedWeather(visibility), now });
    const row = result.rows.find((item) => item.id === "hkg-taf-hourly-breakdown")!;
    expect(row.values[0]).toBe(tone === "nil" ? "NIL" : formatVisibility(visibility));
  });

  it.each(cases)("does not rank the bound in %s as an exact visibility value", (visibility, _tone, risk) => {
    const originFlights = [flight({})];
    const { hours } = buildHourlyArrivalTable({ flights: originFlights, weather: [], now, horizonHours: 6, direction: "arrival" });
    const result = buildOperationalDashboardData({
      originFlights,
      weather: boundedWeather(visibility),
      now,
      hours,
      operationalByIata: new Map([["TPE", mockOperationalData("TPE", { schedules: [{
        flightIata: "BR1",
        flightIcao: null,
        depIata: "TPE",
        arrIata: "HKG",
        depTimeTs: ts("2026-06-29T04:30:00.000Z"),
        arrTimeTs: null,
        depDelayedMinutes: null,
        arrDelayedMinutes: null,
        delayedMinutes: null,
        status: "scheduled"
      }] })]])
    });
    const row = result.hourlyRouteAirportRanking[0];
    expect(row.riskLevel).toBe(risk);
    expect(row.visibilityLabel).toBe(formatVisibility(visibility));
    if (/[<>PM+=]/.test(visibility)) {
      expect(row.visibilityKm).toBeNull();
    } else {
      expect(row.visibilityKm).toBeCloseTo(Number(visibility) * 1.609344);
    }
  });

  it("does not let an uncertain lower bound hide a confirmed low-visibility period", () => {
    const mixedWeather = boundedWeather("P1/4SM").map((item) => ({
      ...item,
      tafPeriods: [...item.tafPeriods, tafPeriod({ visibility: `<${fiveKmSm}` })]
    }));
    const result = buildFlightSituationTable({ flights: [], weather: mixedWeather, now });
    const row = result.rows.find((item) => item.id === "hkg-taf-hourly-breakdown")!;
    expect(row.values[0]).toBe(formatVisibility(`<${fiveKmSm}`));
  });
});

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

  it("summarizes all current-window route airports and marks absent reports as NO DATA", () => {
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
      "no-data"
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

  it("keeps FR24 operations unavailable without making unsupported provider requests", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const flights = [
        flight({ id: "tpe-arrival", routeAirportIata: "TPE" }),
        flight({ id: "hnd-arrival", routeAirportIata: "HND" })
      ];
      const operationalByIata = createUnavailableFlightradar24Data([
        getAirport("TPE")!,
        getAirport("HND")!
      ]);
      const hours = buildHourlyArrivalTable({
        flights,
        weather,
        now,
        horizonHours: 6,
        direction: "arrival"
      }).hours;
      const result = buildOperationalDashboardData({
        originFlights: flights,
        weather,
        operationalByIata,
        now,
        hours
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(operationalByIata.size).toBe(2);
      expect(result.operationalTotals).toMatchObject({
        provider: "Flightradar24",
        status: "unavailable",
        totalAirports: 2,
        availableAirports: 0,
        unavailableAirports: 2,
        delayRate: null,
        cancellationRate: null,
        past6Status: "unavailable",
        trend: "unavailable",
        unavailableReason: FLIGHTRADAR24_OPERATIONAL_UNAVAILABLE_REASON
      });
      for (const insight of result.arrivalOriginOperationalInsights) {
        expect(insight.current.status).toBe("unavailable");
        expect(insight.past6.status).toBe("unavailable");
        expect(insight.current.delayRate).toBeNull();
        expect(insight.current.cancellationRate).toBeNull();
      }
      expect(result.hourlyRouteAirportRanking).toHaveLength(2);
      expect(result.hourlyRouteAirportRanking.every((item) => item.riskLevel === "unavailable"))
        .toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("aggregates mock normalized operational records (not a connected FR24 feed)", () => {
    const hnd = getAirport("HND")!;
    const flights = [
      flight({
        id: "tpe-arrival",
        routeAirportIata: "TPE",
        scheduledTime: "2026-06-29T12:30:00.000+08:00"
      }),
      flight({
        id: "hnd-arrival",
        routeAirportIata: "HND",
        routeAirport: hnd,
        region: hnd.region,
        scheduledTime: "2026-06-29T13:30:00.000+08:00"
      })
    ];
    const hours = buildHourlyArrivalTable({
      flights,
      weather,
      now,
      horizonHours: 6,
      direction: "arrival"
    }).hours;
    const operationalByIata = new Map([
      [
        "TPE",
        mockOperationalData("TPE", {
          schedules: [
            {
              flightIata: "BR1",
              flightIcao: null,
              depIata: "TPE",
              arrIata: "HKG",
              depTimeTs: ts("2026-06-29T04:30:00.000Z"),
              arrTimeTs: null,
              depDelayedMinutes: 45,
              arrDelayedMinutes: null,
              delayedMinutes: null,
              status: "scheduled"
            },
            {
              flightIata: "BR2",
              flightIcao: null,
              depIata: "TPE",
              arrIata: "NRT",
              depTimeTs: ts("2026-06-29T04:40:00.000Z"),
              arrTimeTs: null,
              depDelayedMinutes: null,
              arrDelayedMinutes: null,
              delayedMinutes: null,
              status: "cancelled"
            },
            {
              flightIata: "BR3",
              flightIcao: null,
              depIata: "TPE",
              arrIata: "BKK",
              depTimeTs: ts("2026-06-29T05:30:00.000Z"),
              arrTimeTs: null,
              depDelayedMinutes: null,
              arrDelayedMinutes: null,
              delayedMinutes: null,
              status: "scheduled"
            },
            {
              flightIata: "BRP",
              flightIcao: null,
              depIata: "TPE",
              arrIata: "KIX",
              depTimeTs: ts("2026-06-29T02:30:00.000Z"),
              arrTimeTs: null,
              depDelayedMinutes: 60,
              arrDelayedMinutes: null,
              delayedMinutes: null,
              status: "scheduled"
            }
          ],
          delays: [
            {
              flightIata: "BR1",
              flightIcao: null,
              depIata: "TPE",
              arrIata: "HKG",
              depTimeTs: ts("2026-06-29T04:30:00.000Z"),
              arrTimeTs: null,
              depDelayedMinutes: 45,
              arrDelayedMinutes: null,
              delayedMinutes: 45,
              status: "delayed"
            },
            {
              flightIata: "BRP",
              flightIcao: null,
              depIata: "TPE",
              arrIata: "KIX",
              depTimeTs: ts("2026-06-29T02:30:00.000Z"),
              arrTimeTs: null,
              depDelayedMinutes: 60,
              arrDelayedMinutes: null,
              delayedMinutes: 60,
              status: "delayed"
            }
          ]
        })
      ],
      [
        "HND",
        mockOperationalData("HND", {
          unavailableReason: "Mock normalized operational records unavailable"
        })
      ]
    ]);

    const result = buildOperationalDashboardData({
      originFlights: flights,
      weather,
      operationalByIata,
      now,
      hours
    });
    const tpe = result.arrivalOriginOperationalInsights.find((item) => item.airportIata === "TPE");
    const hndInsight = result.arrivalOriginOperationalInsights.find(
      (item) => item.airportIata === "HND"
    );

    expect(tpe?.current).toMatchObject({
      status: "available",
      totalFlights: 3,
      delayedFlights: 1,
      cancelledFlights: 1,
      affectedFlights: 2
    });
    expect(tpe?.current.delayRate).toBeCloseTo(33.33);
    expect(tpe?.current.cancellationRate).toBeCloseTo(33.33);
    expect(tpe?.past6).toMatchObject({
      status: "available",
      totalFlights: 1,
      delayedFlights: 1,
      affectedFlights: 1
    });
    expect(tpe?.trend).toBe("recovering");
    expect(hndInsight?.current.status).toBe("unavailable");
    expect(result.operationalTotals).toMatchObject({
      totalAirports: 2,
      availableAirports: 1,
      unavailableAirports: 1,
      totalFlights: 3,
      delayedFlights: 1,
      cancelledFlights: 1,
      affectedFlights: 2,
      affectedRoutes: 1
    });
    expect(result.hourlyRouteAirportRanking[0]).toMatchObject({
      airportIata: "TPE",
      route: "TPE → HKG",
      riskLevel: "high",
      flightCount: 1,
      delayedFlights: 1,
      cancelledFlights: 1
    });
    expect(
      result.hourlyRouteAirportRanking.find((item) => item.airportIata === "HND")?.riskLevel
    ).toBe("unavailable");
  });

  it("builds hourly route-airport TAF timelines from structured forecast periods", () => {
    const nrt = getAirport("NRT")!;
    const tafWeather: AirportWeather[] = [
      ...weather.map((risk) =>
        risk.airportIata === "TPE"
          ? {
              ...risk,
              rawTaf:
                "TAF RCTP 290400Z 2904/2907 BECMG 34008KT TEMPO PROB30 4000 +SHRA BKN008 PROB40 FG",
              tafPeriods: [
                tafPeriod({
                  startsAt: "2026-06-29T04:00:00.000Z",
                  endsAt: "2026-06-29T05:00:00.000Z",
                  changeIndicator: "BECMG",
                  windDirectionDeg: 340,
                  windSpeedKt: 8,
                  visibility: "6+",
                  clouds: [
                    { cover: "FEW", baseFt: 2000, type: null },
                    { cover: "BKN", baseFt: 3500, type: null }
                  ]
                }),
                tafPeriod({
                  startsAt: "2026-06-29T05:00:00.000Z",
                  endsAt: "2026-06-29T06:00:00.000Z",
                  probability: 30,
                  category: "reported",
                  label: "REPORTED WX",
                  reasons: ["+SHRA: heavy (+), showers (SH), rain (RA)", "TEMPO", "PROB30"],
                  weatherCodes: ["+SHRA"],
                  changeIndicator: "TEMPO",
                  windDirectionDeg: 90,
                  windSpeedKt: 18,
                  windGustKt: 35,
                  visibility: "1.99",
                  clouds: [{ cover: "BKN", baseFt: 800, type: null }]
                }),
                tafPeriod({
                  startsAt: "2026-06-29T06:00:00.000Z",
                  endsAt: "2026-06-29T07:00:00.000Z",
                  probability: 40,
                  category: "reported",
                  label: "REPORTED WX",
                  reasons: ["FG: fog (FG)", "PROB40"],
                  weatherCodes: ["FG"],
                  changeIndicator: "PROB40",
                  windDirectionDeg: "VRB",
                  windSpeedKt: 4,
                  visibility: "0.5",
                  clouds: [{ cover: "VV", baseFt: 200, type: null }]
                })
              ]
            }
          : risk
      ),
      {
        airportIata: "NRT",
        airportIcao: "RJAA",
        category: "unknown",
        label: "NO DATA",
        reasons: ["TAF unavailable"],
        weatherCodes: [],
        metar: null,
        tafQueried: false,
        tafPeriods: [],
        rawMetar: null,
        rawTaf: null,
        tafIssuedAt: null,
        observedAt: null
      }
    ];

    const timelines = buildRouteAirportTafTimelines({
      flights: [
        flight({ id: "tpe-arrival", routeAirportIata: "TPE" }),
        flight({
          id: "nrt-departure",
          direction: "departure",
          routeAirportIata: "NRT",
          routeAirport: nrt,
          region: nrt.region,
          route: greatCircleRoute(HKG_AIRPORT, nrt)
        })
      ],
      weather: tafWeather,
      now,
      horizonHours: 6,
      direction: "both"
    });

    expect(timelines.map((timeline) => timeline.airportIata)).toEqual(["NRT", "TPE"]);
    expect(timelines[0].cells.every((cell) => cell.summary === "NO DATA")).toBe(true);
    const tpeTimeline = timelines.find((timeline) => timeline.airportIata === "TPE")!;
    expect(tpeTimeline.cells).toHaveLength(6);
    expect(tpeTimeline.cells[0]).toMatchObject({
      tone: "normal",
      summary: expect.stringContaining("BECMG")
    });
    expect(tpeTimeline.cells[0].summary).toContain("NSW");
    expect(tpeTimeline.cells[0].summary).toContain("340/8kt");
    expect(tpeTimeline.cells[0].summary).toContain("VIS >9.7 km");
    expect(tpeTimeline.cells[0].summary).toContain("FEW020/BKN035");
    expect(tpeTimeline.cells[1]).toMatchObject({
      tone: "concern",
      weatherCodes: ["+SHRA"]
    });
    expect(tpeTimeline.cells[1].summary).toContain("TEMPO PROB30");
    expect(tpeTimeline.cells[1].summary).toContain("090/18G35kt");
    expect(tpeTimeline.cells[1].summary).toContain("VIS 1.99 sm / 3.2 km");
    expect(tpeTimeline.cells[1].summary).toContain("BKN008");
    expect(tpeTimeline.cells[2].summary).toContain("PROB40");
    expect(tpeTimeline.cells[2].summary).toContain("VRB/4kt");
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
    expect(result.rows.slice(0, 3).map((row) => row.id)).toEqual([
      "predicted-arrival-rate",
      "deep-convection",
      "hkg-taf-hourly-breakdown"
    ]);
    expect(result.rows.find((row) => row.id === "predicted-arrival-rate")?.values[0]).toBe(2);
    expect(result.rows.find((row) => row.id === "Greater China-en-route")?.values[0]).toBe(1);
    expect(result.rows.find((row) => row.id === "Greater China-within-100km")?.values[0]).toBe(1);
    expect(result.rows.find((row) => row.id === "Greater China-on-land")?.values[0]).toBe(1);
  });

  it("excludes arrivals outside the visible situation table window from phase rows", () => {
    const result = buildFlightSituationTable({
      flights: [
        flight({
          id: "outside-table-window",
          scheduledTime: "2026-06-30T08:00:00.000+08:00"
        })
      ],
      weather,
      now
    });

    expect(result.hours).toHaveLength(16);
    expect(result.rows.find((row) => row.id === "predicted-arrival-rate")?.values).toEqual(
      Array.from({ length: 16 }, () => 0)
    );
    expect(result.rows.find((row) => row.id === "Greater China-on-land")?.values).toEqual(
      Array.from({ length: 16 }, () => 0)
    );
    expect(result.rows.find((row) => row.id === "Greater China-en-route")?.values).toEqual(
      Array.from({ length: 16 }, () => 0)
    );
    expect(result.rows.find((row) => row.id === "Greater China-within-100km")?.values).toEqual(
      Array.from({ length: 16 }, () => 0)
    );
  });

  it("limits the HKG TAF hourly row to significant weather elements", () => {
    const tafWeather = weather.map((risk) =>
      risk.airportIata === "HKG"
        ? {
            ...risk,
            tafPeriods: [
              tafPeriod({
                startsAt: "2026-06-29T04:00:00.000Z",
                endsAt: "2026-06-29T05:00:00.000Z",
                category: "reported" as const,
                label: "REPORTED WX",
                reasons: ["SHRA: showers (SH), rain (RA)", "TEMPO"],
                weatherCodes: ["SHRA"],
                changeIndicator: "TEMPO",
                windDirectionDeg: 90,
                windSpeedKt: 18,
                visibility: "6+",
                clouds: [{ cover: "BKN", baseFt: 3000, type: null }]
              }),
              tafPeriod({
                startsAt: "2026-06-29T05:00:00.000Z",
                endsAt: "2026-06-29T06:00:00.000Z",
                category: "reported" as const,
                label: "REPORTED WX",
                reasons: ["+SHRA: heavy (+), showers (SH), rain (RA)", "TEMPO"],
                weatherCodes: ["+SHRA"],
                changeIndicator: "TEMPO",
                windDirectionDeg: 90,
                windSpeedKt: 18,
                windGustKt: 35,
                visibility: "1.99",
                clouds: [{ cover: "BKN", baseFt: 800, type: null }]
              })
            ]
          }
        : risk
    );

    const result = buildFlightSituationTable({
      flights: [],
      weather: tafWeather,
      now
    });

    const tafRow = result.rows.find((row) => row.id === "hkg-taf-hourly-breakdown");
    expect(tafRow?.label).toBe("HKG TAF significant weather");
    expect(tafRow?.values[0]).toBe("NIL");
    expect(tafRow?.values[1]).toContain("+SHRA");
    expect(tafRow?.values[1]).toContain("VIS 1.99 sm / 3.2 km");
    expect(tafRow?.values[1]).toContain("CIG 800ft");
    expect(tafRow?.values[1]).toContain("G35");
    expect(tafRow?.values[1]).not.toContain("TEMPO");
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
              windGustKt: 31,
              visibility: "6+",
              clouds: []
            },
            tafPeriods: [
              tafPeriod({
                startsAt: "2026-06-29T05:00:00.000Z",
                endsAt: "2026-06-29T06:00:00.000Z",
                category: "reported",
                label: "REPORTED WX",
                reasons: ["SHRA: showers (SH), rain (RA)", "TEMPO"],
                weatherCodes: ["SHRA"],
                changeIndicator: "TEMPO",
                windDirectionDeg: 90,
                windSpeedKt: 18
              }),
              tafPeriod({
                startsAt: "2026-06-29T06:00:00.000Z",
                endsAt: "2026-06-29T07:00:00.000Z",
                category: "reported",
                label: "REPORTED WX",
                reasons: ["+SHRA: heavy (+), showers (SH), rain (RA)", "TEMPO"],
                weatherCodes: ["+SHRA"],
                changeIndicator: "TEMPO",
                windDirectionDeg: 90,
                windSpeedKt: 18,
                windGustKt: 35
              })
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
    expect(convection?.values[1]).toContain("SHRA");
    expect(convection?.tones?.[1]).toBe("caution");
    expect(convection?.values[2]).toContain("+SHRA");
    expect(convection?.tones?.[2]).toBe("alert");
  });
});
