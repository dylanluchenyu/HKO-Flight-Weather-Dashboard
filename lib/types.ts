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
export type FlightPhase =
  | "onGround"
  | "enRoute"
  | "within100km"
  | "completed"
  | "unknown";
export type WeatherCategory = "unknown" | "none" | "reported";

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

export interface WeatherAssessment {
  category: WeatherCategory;
  label: string;
  reasons: string[];
  weatherCodes: string[];
}

export interface WeatherObservation extends WeatherAssessment {
  observedAt: string | null;
  reportType: string | null;
}

export interface WeatherForecastPeriod extends WeatherAssessment {
  startsAt: string;
  endsAt: string;
  probability: number | null;
  changeIndicator: string | null;
}

export interface AirportWeather extends WeatherAssessment {
  airportIata: string;
  airportIcao: string;
  metar: WeatherObservation | null;
  tafPeriods: WeatherForecastPeriod[];
  rawMetar: string | null;
  rawTaf: string | null;
  observedAt: string | null;
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
  routeAirport: AirportMetadata | null;
  region: Region;
  statusText: string | null;
  statusCode: string | null;
  statusNow: FlightPhase;
  distanceKm: number | null;
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
  status?: FlightPhase;
  values: Array<number | string>;
  weatherCategory?: WeatherCategory[];
}

export interface HorizonAirportSummary {
  airportIata: string;
  airport: AirportMetadata | null;
  count: number;
  weather: AirportWeather | null;
}

export interface HorizonSummary {
  hours: 6 | 12 | 18 | 24 | 30;
  departureDestinations: HorizonAirportSummary[];
  arrivalOrigins: HorizonAirportSummary[];
  reportedWeatherAirports: HorizonAirportSummary[];
}

export interface DashboardData {
  generatedAt: string;
  cacheExpiresAt: string;
  sourceUpdatedAt: string | null;
  hours: HourlyCell[];
  hourlyArrivalTable: TableRow[];
  horizons: HorizonSummary[];
  flights: NormalizedFlight[];
  airports: AirportMetadata[];
  weather: AirportWeather[];
  warnings: string[];
}

export interface DashboardOptions {
  direction: FlightDirection | "both";
  traffic: TrafficType | "both";
  horizonHours: 6 | 12 | 15 | 18 | 24 | 30;
  refresh: boolean;
}

export interface DashboardError {
  error: string;
  warnings: string[];
}
