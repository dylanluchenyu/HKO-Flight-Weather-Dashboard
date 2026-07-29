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
export type FlightSituationCellTone = "plain" | "nil" | "caution" | "alert";
export type FlightSituationRowKind = "rate" | "convection" | "taf" | "phase";
export type TafTimelineCellTone = "normal" | "concern" | "no-data" | "not-queried";
export type RouteAirportWeatherStatus =
  | "metar"
  | "taf"
  | "metar-taf"
  | "none"
  | "no-data"
  | "not-queried";
export type WeatherSourceKind = "METAR" | "TAF";

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
  windGustKt: number | null;
  visibility: string | null;
  clouds: WeatherCloudLayer[];
}

export interface WeatherCloudLayer {
  cover: string | null;
  baseFt: number | null;
  type: string | null;
}

export interface WeatherForecastPeriod extends WeatherAssessment {
  startsAt: string;
  endsAt: string;
  probability: number | null;
  changeIndicator: string | null;
  windDirectionDeg: number | string | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
  visibility: string | null;
  clouds: WeatherCloudLayer[];
}

export interface AirportWeather extends WeatherAssessment {
  airportIata: string;
  airportIcao: string;
  metar: WeatherObservation | null;
  tafQueried: boolean;
  tafPeriods: WeatherForecastPeriod[];
  rawMetar: string | null;
  rawTaf: string | null;
  tafIssuedAt: string | null;
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
  values: Array<number | string>;
  weatherCategory?: WeatherCategory[];
}

export interface FlightSituationRow {
  id: string;
  label: string;
  kind: FlightSituationRowKind;
  region?: Region;
  values: Array<number | string>;
  tones?: FlightSituationCellTone[];
}

export interface RouteAirportSummary {
  airportIata: string;
  airport: AirportMetadata | null;
  count: number;
  arrivalCount: number;
  departureCount: number;
  weatherStatus: RouteAirportWeatherStatus;
  weatherCodes: string[];
}

export interface RouteWeatherSource {
  kind: WeatherSourceKind;
  weatherCodes: string[];
  reasons: string[];
  observedAt?: string | null;
  startsAt?: string;
  endsAt?: string;
  probability?: number | null;
  changeIndicator?: string | null;
}

export interface RouteWeatherMatch {
  airportIata: string;
  airport: AirportMetadata | null;
  flightCount: number;
  arrivalCount: number;
  departureCount: number;
  sources: RouteWeatherSource[];
}

export interface RouteAirportTafCell {
  hourOffset: number;
  startsAt: string;
  endsAt: string;
  tone: TafTimelineCellTone;
  summary: string;
  details: string[];
  weatherCodes: string[];
  changeIndicator: string | null;
  probability: number | null;
}

export interface RouteAirportTafTimeline {
  airportIata: string;
  airport: AirportMetadata | null;
  flightCount: number;
  arrivalCount: number;
  departureCount: number;
  rawTaf: string | null;
  issuedAt: string | null;
  cells: RouteAirportTafCell[];
}

export interface DashboardData {
  generatedAt: string;
  cacheExpiresAt: string;
  sourceUpdatedAt: string | null;
  hours: HourlyCell[];
  hourlyArrivalTable: TableRow[];
  situationHours: HourlyCell[];
  flightSituationRows: FlightSituationRow[];
  routeAirportSummaries: RouteAirportSummary[];
  routeWeatherMatches: RouteWeatherMatch[];
  routeAirportTafTimelines: RouteAirportTafTimeline[];
  flights: NormalizedFlight[];
  airports: AirportMetadata[];
  weather: AirportWeather[];
  warnings: string[];
}

export interface DashboardOptions {
  direction: FlightDirection | "both";
  traffic: TrafficType | "both";
  horizonHours: 6 | 12 | 18 | 24 | 30;
  refresh: boolean;
}

export interface DashboardError {
  error: string;
  warnings: string[];
}
