import { describe, expect, it } from "vitest";
import { normalizeAirportWeather, tafWeatherAt } from "./weather";

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
