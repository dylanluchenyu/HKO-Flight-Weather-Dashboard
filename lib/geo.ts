import type { AirportMetadata, RoutePoint } from "./types";

export const HKG_AIRPORT: AirportMetadata = {
  iata: "HKG",
  icao: "VHHH",
  name: "Hong Kong International Airport",
  city: "Hong Kong",
  country: "Hong Kong",
  region: "Greater China",
  lat: 22.308,
  lon: 113.9185
};

const EARTH_RADIUS_KM = 6371;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function distanceKm(a: RoutePoint, b: RoutePoint): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
}

export function greatCircleRoute(
  from: RoutePoint,
  to: RoutePoint,
  steps = 28
): RoutePoint[] {
  const lat1 = toRadians(from.lat);
  const lon1 = toRadians(from.lon);
  const lat2 = toRadians(to.lat);
  const lon2 = toRadians(to.lon);
  const angularDistance = distanceKm(from, to) / EARTH_RADIUS_KM;

  if (angularDistance === 0) {
    return [from, to];
  }

  const points: RoutePoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const fraction = i / steps;
    const a =
      Math.sin((1 - fraction) * angularDistance) / Math.sin(angularDistance);
    const b = Math.sin(fraction * angularDistance) / Math.sin(angularDistance);
    const x =
      a * Math.cos(lat1) * Math.cos(lon1) +
      b * Math.cos(lat2) * Math.cos(lon2);
    const y =
      a * Math.cos(lat1) * Math.sin(lon1) +
      b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);
    points.push({ lat: toDegrees(lat), lon: toDegrees(lon) });
  }
  return points;
}

export function projectPoint(point: RoutePoint, width: number, height: number) {
  return {
    x: ((point.lon + 180) / 360) * width,
    y: ((90 - point.lat) / 180) * height
  };
}
