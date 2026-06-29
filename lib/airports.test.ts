import { describe, expect, it } from "vitest";
import { getAirport, inferRegionFromCountry } from "./airports";

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
});
