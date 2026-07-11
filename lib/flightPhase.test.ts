import { describe, expect, it } from "vitest";
import { estimateFlightPhase, estimatedFlightDurationHours } from "./flightPhase";

describe("point-in-time flight phase estimation", () => {
  const scheduled = new Date("2026-06-29T12:00:00.000Z");
  const distanceKm = 820;

  it("moves an arrival from origin ground to en route, within 100km, then completed", () => {
    expect(
      estimateFlightPhase({
        at: new Date("2026-06-29T10:00:00.000Z"),
        scheduledTime: scheduled,
        distanceKm,
        direction: "arrival"
      })
    ).toBe("onGround");
    expect(
      estimateFlightPhase({
        at: new Date("2026-06-29T11:30:00.000Z"),
        scheduledTime: scheduled,
        distanceKm,
        direction: "arrival"
      })
    ).toBe("enRoute");
    expect(
      estimateFlightPhase({
        at: new Date("2026-06-29T11:55:00.000Z"),
        scheduledTime: scheduled,
        distanceKm,
        direction: "arrival"
      })
    ).toBe("within100km");
    expect(
      estimateFlightPhase({
        at: scheduled,
        scheduledTime: scheduled,
        distanceKm,
        direction: "arrival"
      })
    ).toBe("completed");
  });

  it("moves a departure from HKIA ground through the same airborne phases", () => {
    expect(
      estimateFlightPhase({
        at: new Date("2026-06-29T11:59:00.000Z"),
        scheduledTime: scheduled,
        distanceKm,
        direction: "departure"
      })
    ).toBe("onGround");
    expect(
      estimateFlightPhase({
        at: new Date("2026-06-29T12:05:00.000Z"),
        scheduledTime: scheduled,
        distanceKm,
        direction: "departure"
      })
    ).toBe("within100km");
    expect(
      estimateFlightPhase({
        at: new Date("2026-06-29T12:30:00.000Z"),
        scheduledTime: scheduled,
        distanceKm,
        direction: "departure"
      })
    ).toBe("enRoute");
    const completedAt = new Date(
      scheduled.getTime() + estimatedFlightDurationHours(distanceKm) * 60 * 60 * 1000
    );
    expect(
      estimateFlightPhase({
        at: completedAt,
        scheduledTime: scheduled,
        distanceKm,
        direction: "departure"
      })
    ).toBe("completed");
  });

  it("returns explicit unknown when distance is unavailable", () => {
    expect(
      estimateFlightPhase({
        at: new Date("2026-06-29T11:00:00.000Z"),
        scheduledTime: scheduled,
        distanceKm: null,
        direction: "arrival"
      })
    ).toBe("unknown");
  });
});
