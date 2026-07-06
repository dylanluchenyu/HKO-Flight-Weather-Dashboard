export type TrafficType = "passenger" | "cargo";
export type FlightDirection = "arrival" | "departure";
export type Region =
  | "Greater China"
  | "Asia"
  | "Middle East"
  | "Oceania"
  | "America"
  | "Africa"
  | "Europe"
  | "Other";
export type FlightStatus = "enRoute" | "onLand" | "within100km";
export type ArrivalStatus = FlightStatus;
export type WeatherRiskLevel = "nil" | "caution" | "significant" | "severe";

export interface AirportMetadata {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  region: Region;
  lat: number;
  lon: number;
}

export interface WeatherRisk {
  airportIata: string;
  airportIcao: string;
  level: WeatherRiskLevel;
  label: string;
  reasons: string[];
  rawMetar?: string;
  rawTaf?: string;
  observedAt?: string;
}

export interface RoutePoint {
  lat: number;
  lon: number;
}

export interface NormalizedFlight {
  id: string;
  flightNumbers: string[];
  airlineCodes: string[];
  scheduledTime: string;
  direction: FlightDirection;
  trafficType: TrafficType;
  routeAirportIata: string;
  routeAirport?: AirportMetadata;
  region: Region;
  statusText?: string;
  statusCode?: string | null;
  arrivalStatus?: ArrivalStatus;
  flightStatus?: FlightStatus;
  distanceKm?: number;
  route: RoutePoint[];
}

export interface HourlyCell {
  hourOffset: number;
  label: string;
  startsAt: string;
  endsAt: string;
}

export interface TableRow {
  id: string;
  label: string;
  region?: Region;
  status?: FlightStatus;
  values: Array<number | string>;
  severity?: WeatherRiskLevel[];
}

export interface HorizonAirportSummary {
  airportIata: string;
  airport?: AirportMetadata;
  count: number;
  weather?: WeatherRisk;
}

export interface HorizonSummary {
  hours: 6 | 12 | 18 | 24 | 30;
  departureDestinations: HorizonAirportSummary[];
  arrivalOrigins: HorizonAirportSummary[];
  badWeatherAirports: HorizonAirportSummary[];
}

export interface DashboardData {
  generatedAt: string;
  cacheExpiresAt: string;
  sourceUpdatedAt?: string;
  hours: HourlyCell[];
  hourlyArrivalTable: TableRow[];
  horizons: HorizonSummary[];
  flights: NormalizedFlight[];
  airports: AirportMetadata[];
  weather: WeatherRisk[];
  warnings: string[];
}

export interface DashboardOptions {
  direction: FlightDirection | "both";
  traffic: TrafficType | "both";
  horizonHours: 6 | 12 | 15 | 18 | 24 | 30;
  refresh: boolean;
}
