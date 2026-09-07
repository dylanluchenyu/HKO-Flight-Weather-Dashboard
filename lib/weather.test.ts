import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWeatherForAirports, normalizeAirportWeather, tafWeatherAt } from "./weather";
import type { AirportMetadata } from "./types";

afterEach(() => vi.unstubAllGlobals());

function testAirports(count: number): AirportMetadata[] {
  return Array.from({ length: count }, (_, index) => ({
    iata: `A${index}`,
    icao: `Z${String(index).padStart(3, "0")}`,
    name: `Test airport ${index}`,
    city: "Test city",
    country: "Test country",
    region: "Asia",
    lat: 0,
    lon: 0
  }));
}

describe("complete batched weather coverage", () => {
  it("queries METAR and TAF for every airport beyond the former 45/72/90 caps", async () => {
    const airports = testAirports(101);
    const requested: Record<string, string[]> = { metar: [], taf: [] };
    const fetchMock = vi.fn(async (input: URL) => {
      const endpoint = input.pathname.split("/").at(-1)!;
      const ids = input.searchParams.get("ids")!.split(",");
      expect(ids.length).toBeLessThanOrEqual(45);
      requested[endpoint].push(...ids);
      return Response.json(ids.map((icaoId) => ({
        icaoId,
        ...(endpoint === "metar" ? { rawOb: `${icaoId} CAVOK` } : {
          rawTAF: `TAF ${icaoId}`,
          fcsts: [{ timeFrom: 1782705600, timeTo: 1782763200, wxString: "NSW" }]
        })
      })));
    });
    vi.stubGlobal("fetch", fetchMock);
    const warnings: string[] = [];
    const result = await fetchWeatherForAirports(airports, warnings);
    expect(requested.metar.sort()).toEqual(airports.map((airport) => airport.icao).sort());
    expect(requested.taf.sort()).toEqual(airports.map((airport) => airport.icao).sort());
    expect(result).toHaveLength(101);
    expect(result.every((airport) => airport.tafQueried && airport.rawTaf && airport.rawMetar)).toBe(true);
    expect(warnings).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("retries a failed batch and preserves other METAR/TAF batches after a permanent failure", async () => {
    const airports = testAirports(91);
    const attempts = new Map<string, number>();
    vi.stubGlobal("fetch", vi.fn(async (input: URL) => {
      const endpoint = input.pathname.split("/").at(-1)!;
      const ids = input.searchParams.get("ids")!.split(",");
      const key = `${endpoint}:${ids[0]}`;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      if ((endpoint === "metar" && ids[0] === "Z045") ||
          (endpoint === "taf" && ids[0] === "Z090" && attempt === 1)) {
        return new Response("temporarily unavailable", { status: 503 });
      }
      return Response.json(ids.map((icaoId) => ({
        icaoId,
        ...(endpoint === "metar" ? { rawOb: `${icaoId} CAVOK` } : { rawTAF: `TAF ${icaoId}` })
      })));
    }));
    const warnings: string[] = [];
    const result = await fetchWeatherForAirports(airports, warnings);
    expect(attempts.get("metar:Z045")).toBe(2);
    expect(attempts.get("taf:Z090")).toBe(2);
    expect(result[0].rawMetar).not.toBeNull();
    expect(result[45].rawMetar).toBeNull();
    expect(result[45].rawTaf).not.toBeNull();
    expect(result[90].rawMetar).not.toBeNull();
    expect(result[90].rawTaf).not.toBeNull();
    expect(result.every((airport) => airport.tafQueried)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("METAR unavailable after 2 attempts");
  });

  it("treats a successful empty response as queried NO DATA, not a failed or omitted query", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const warnings: string[] = [];
    const result = await fetchWeatherForAirports(testAirports(1), warnings);
    expect(result[0]).toMatchObject({ tafQueried: true, category: "unknown", label: "NO DATA" });
    expect(warnings).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("source-backed METAR/TAF weather categories", () => {
  it("reports the exact structured thunderstorm code without assigning severity", () => {
    const weather = normalizeAirportWeather({
      airportIata: "HKG",
      airportIcao: "VHHH",
      metar: {
        icaoId: "VHHH",
        metarType: "METAR",
        rawOb: "VHHH 290800Z 09012KT 4000 TSRA BKN012 28/24 Q1006",
        wxString: "TSRA",
        visib: "4000",
        clouds: [{ cover: "BKN", base: 1200, type: null }]
      }
    });

    expect(weather.category).toBe("reported");
    expect(weather.weatherCodes).toEqual(["TSRA"]);
    expect(weather.reasons[0]).toContain("thunderstorms (TS)");
    expect(weather.reasons[0]).toContain("rain (RA)");
    expect(weather.metar?.reportType).toBe("METAR");
    expect(weather.metar?.visibility).toBe("4000");
    expect(weather.metar?.clouds).toEqual([{ cover: "BKN", baseFt: 1200, type: null }]);
  });

  it("expands less common HKO weather codes instead of leaving unexplained fragments", () => {
    const weather = normalizeAirportWeather({
      airportIata: "TST",
      airportIcao: "TEST",
      metar: {
        icaoId: "TEST",
        rawOb: "TEST 290800Z 18012KT 3000 BLDU TSGS",
        wxString: "BLDU TSGS"
      }
    });

    expect(weather.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("blowing (BL), widespread dust (DU)"),
        expect.stringContaining("thunderstorms (TS), small hail or snow pellets (GS)")
      ])
    );
    expect(weather.reasons.join(" ")).not.toContain("unexpanded code");
  });

  it("does not turn wind, visibility, or cloud values into an invented impact level", () => {
    const weather = normalizeAirportWeather({
      airportIata: "NRT",
      airportIcao: "RJAA",
      metar: {
        icaoId: "RJAA",
        rawOb: "RJAA 290800Z 18020G38KT 9999 BKN006 21/19 Q1009",
        wxString: null,
        wgst: 38,
        visib: "9999",
        clouds: [{ cover: "BKN", base: 600, type: null }]
      }
    });

    expect(weather.category).toBe("none");
    expect(weather.label).toBe("NO REPORTED WX");
    expect(weather.metar?.windGustKt).toBe(38);
    expect(weather.metar?.visibility).toBe("9999");
    expect(weather.metar?.clouds).toEqual([{ cover: "BKN", baseFt: 600, type: null }]);
  });

  it("preserves TAF change type, probability, validity, and reported code", () => {
    const weather = normalizeAirportWeather({
      airportIata: "TPE",
      airportIcao: "RCTP",
      taf: {
        icaoId: "RCTP",
        issueTime: "2026-06-29T05:00:00.000Z",
        rawTAF: "TAF RCTP 290500Z 2906/3012 PROB30 TEMPO 4000 +SHRA",
        fcsts: [
          {
            timeFrom: "2026-06-29T06:00:00.000Z",
            timeTo: "2026-06-29T08:00:00.000Z",
            fcstChange: "TEMPO",
            probability: 30,
            wxString: "+SHRA",
            wdir: 90,
            wspd: 18,
            wgst: 35,
            visib: "4000",
            clouds: [{ cover: "BKN", base: 800, type: "CB" }]
          }
        ]
      }
    });

    expect(weather.category).toBe("reported");
    expect(weather.tafPeriods[0]).toMatchObject({
      category: "reported",
      probability: 30,
      changeIndicator: "TEMPO",
      weatherCodes: ["+SHRA"],
      windDirectionDeg: 90,
      windSpeedKt: 18,
      windGustKt: 35,
      visibility: "4000",
      clouds: [{ cover: "BKN", baseFt: 800, type: "CB" }]
    });
    expect(weather.tafQueried).toBe(true);
    expect(weather.tafIssuedAt).toBe("2026-06-29T05:00:00.000Z");
    expect(weather.tafPeriods[0].reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("heavy (+)"), "TEMPO", "PROB30"])
    );
  });

  it("never scans airport identifiers or raw control words as weather codes", () => {
    for (const [icaoId, rawOb] of [
      ["WSSS", "METAR WSSS 290800Z 17012KT CAVOK"],
      ["ZSFZ", "METAR ZSFZ 290800Z 28006MPS 9999"],
      ["KLAX", "SPECI KLAX 290800Z 27010KT 10SM SCT020"]
    ]) {
      const weather = normalizeAirportWeather({
        airportIata: "TST",
        airportIcao: icaoId,
        metar: { icaoId, rawOb, wxString: null },
        taf: {
          icaoId,
          rawTAF: `TAF ${icaoId} 290500Z 2906/3012 CAVOK TEMPO NSW RMK NXT FCST`,
          fcsts: [
            {
              timeFrom: "2026-06-29T06:00:00.000Z",
              timeTo: "2026-06-29T08:00:00.000Z",
              wxString: "NSW"
            }
          ]
        }
      });
      expect(weather.category).toBe("none");
    }
  });

  it("applies a TAF weather code only to overlapping forecast hours", () => {
    const weather = normalizeAirportWeather({
      airportIata: "HKG",
      airportIcao: "VHHH",
      taf: {
        icaoId: "VHHH",
        rawTAF: "TAF VHHH",
        fcsts: [
          {
            timeFrom: "2026-06-29T06:00:00.000Z",
            timeTo: "2026-06-29T08:00:00.000Z",
            wxString: "FG"
          }
        ]
      }
    });

    expect(
      tafWeatherAt(
        weather,
        new Date("2026-06-29T06:30:00.000Z"),
        new Date("2026-06-29T07:30:00.000Z")
      ).category
    ).toBe("reported");
    expect(
      tafWeatherAt(
        weather,
        new Date("2026-06-29T08:00:00.000Z"),
        new Date("2026-06-29T09:00:00.000Z")
      ).category
    ).toBe("unknown");
  });

  it("reports missing METAR and TAF as NO DATA", () => {
    const weather = normalizeAirportWeather({ airportIata: "ZZZ", airportIcao: "ZZZZ" });
    expect(weather.category).toBe("unknown");
    expect(weather.label).toBe("NO DATA");
  });
});
