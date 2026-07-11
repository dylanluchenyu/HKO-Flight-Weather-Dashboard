import type { FlightDirection, FlightPhase } from "./types";

export const CRUISE_SPEED_KMH = 820;
export const AIRBORNE_BUFFER_HOURS = 0.55;
export const FLIGHT_LOOKBACK_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

export function estimatedFlightDurationHours(distanceKm: number): number {
  return Math.max(1, distanceKm / CRUISE_SPEED_KMH + AIRBORNE_BUFFER_HOURS);
}

export function estimateFlightPhase(args: {
  at: Date;
  scheduledTime: Date;
  distanceKm: number | null;
  direction: FlightDirection;
}): FlightPhase {
  const atMs = args.at.getTime();
  const scheduledMs = args.scheduledTime.getTime();

  if (!Number.isFinite(atMs) || !Number.isFinite(scheduledMs)) {
    return "unknown";
  }

  if (args.distanceKm === null || !Number.isFinite(args.distanceKm) || args.distanceKm <= 0) {
    if (args.direction === "departure" && atMs < scheduledMs) {
      return "onGround";
    }
    if (args.direction === "arrival" && atMs >= scheduledMs) {
      return "completed";
    }
    return "unknown";
  }

  const durationHours = estimatedFlightDurationHours(args.distanceKm);

  if (args.direction === "departure") {
    if (atMs < scheduledMs) {
      return "onGround";
    }

    const arrivalMs = scheduledMs + durationHours * HOUR_MS;
    if (atMs >= arrivalMs) {
      return "completed";
    }

    const elapsedHours = (atMs - scheduledMs) / HOUR_MS;
    const distanceFromHongKong = Math.min(
      args.distanceKm,
      elapsedHours * CRUISE_SPEED_KMH
    );
    return distanceFromHongKong <= 100 ? "within100km" : "enRoute";
  }

  if (atMs >= scheduledMs) {
    return "completed";
  }

  const estimatedDepartureMs = scheduledMs - durationHours * HOUR_MS;
  if (atMs < estimatedDepartureMs) {
    return "onGround";
  }

  const remainingHours = (scheduledMs - atMs) / HOUR_MS;
  const remainingDistance = Math.min(
    args.distanceKm,
    remainingHours * CRUISE_SPEED_KMH
  );
  return remainingDistance <= 100 ? "within100km" : "enRoute";
}
