import { describe, expect, it } from "vitest";
import { classifyWeatherRisk } from "./weather";

describe("weather risk classification", () => {
  it("flags thunderstorm reports as severe", () => {
    const risk = classifyWeatherRisk({
      airportIata: "HKG",
      airportIcao: "VHHH",
      metar: {
        icaoId: "VHHH",
        rawOb: "VHHH 290800Z 09012KT 4000 TSRA BKN012 28/24 Q1006",
        wxString: "TSRA",
        clouds: [{ cover: "BKN", base: 1200 }]
      }
    });

    expect(risk.level).toBe("severe");
    expect(risk.reasons).toContain("Weather code TS");
  });

  it("flags low ceiling and strong gusts as significant", () => {
    const risk = classifyWeatherRisk({
      airportIata: "NRT",
      airportIcao: "RJAA",
      metar: {
        icaoId: "RJAA",
        rawOb: "RJAA 290800Z 18020G38KT 9999 BKN006 21/19 Q1009",
        wgst: 38,
        visib: "10+",
        clouds: [{ cover: "BKN", base: 600 }]
      }
    });

    expect(risk.level).toBe("significant");
    expect(risk.reasons).toEqual(
      expect.arrayContaining(["Wind/gust 38 kt", "Ceiling 600 ft"])
    );
  });
});
