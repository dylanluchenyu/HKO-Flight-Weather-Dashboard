import { describe, expect, it } from "vitest";
import { distanceKm, greatCircleRoute, HKG_AIRPORT } from "./geo";
import { getAirport } from "./airports";

describe("geo helpers", () => {
  it("calculates plausible HKG to Taipei distance", () => {
    const tpe = getAirport("TPE");
    expect(tpe).toBeDefined();
    const distance = distanceKm(HKG_AIRPORT, tpe!);
    expect(distance).toBeGreaterThan(750);
    expect(distance).toBeLessThan(900);
  });

  it("builds a great-circle route with endpoints preserved", () => {
    const nrt = getAirport("NRT");
    expect(nrt).toBeDefined();
    const route = greatCircleRoute(HKG_AIRPORT, nrt!, 8);
    expect(route).toHaveLength(9);
    expect(route[0].lat).toBeCloseTo(HKG_AIRPORT.lat);
    expect(route.at(-1)?.lon).toBeCloseTo(nrt!.lon);
  });
});
