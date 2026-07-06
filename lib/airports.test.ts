import { describe, expect, it } from "vitest";
import { getAirport, inferRegionFromCountry } from "./airports";
import { regionFromOurAirports } from "./airportFallback";

describe("airport metadata", () => {
  it("maps IATA to ICAO and region", () => {
    const airport = getAirport("DXB");
    expect(airport?.icao).toBe("OMDB");
    expect(airport?.region).toBe("Middle East");
  });

  it("keeps unknown mappings explicit", () => {
    expect(getAirport("ZZZ")).toBeUndefined();
    expect(inferRegionFromCountry(undefined)).toBe("Other");
  });

  it("classifies Greater China and other continents consistently", () => {
    expect(inferRegionFromCountry("Hong Kong")).toBe("Greater China");
    expect(inferRegionFromCountry("Taiwan")).toBe("Greater China");
    expect(inferRegionFromCountry("South Africa")).toBe("Africa");
    expect(regionFromOurAirports("AF", "ZA")).toBe("Africa");
    expect(regionFromOurAirports("SA", "BR")).toBe("America");
  });
});
