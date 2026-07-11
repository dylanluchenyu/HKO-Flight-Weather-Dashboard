"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import type {
  AirportWeather,
  DashboardError,
  DashboardData,
  HorizonAirportSummary,
  NormalizedFlight,
  Region,
  TableRow,
  TrafficType,
  WeatherAssessment,
  WeatherCategory
} from "@/lib/types";

const REFRESH_MS = 30 * 60 * 1000;
type DirectionFilter = "both" | "arrival" | "departure";
type TrafficFilter = "both" | TrafficType;
type HorizonFilter = 6 | 12 | 15 | 18 | 24 | 30;
const REGION_ORDER: Array<Region | "Other"> = [
  "Greater China",
  "Asia",
  "Middle East",
  "Oceania",
  "America",
  "Africa",
  "Europe",
  "Other"
];

function formatDateTime(value?: string | null): string {
  if (!value) {
    return "Not available";
  }
  return new Intl.DateTimeFormat("en-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function formatClock(value?: string | null): string {
  if (!value) {
    return "--:--";
  }
  return new Intl.DateTimeFormat("en-HK", {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function formatUtcClock(value?: string | null): string {
  if (!value) {
    return "--:--Z";
  }
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value))}Z`;
}

function weatherClass(category?: WeatherCategory): string {
  return `weather-${category ?? "unknown"}`;
}

function statusLabel(status?: string): string {
  if (status === "enRoute") {
    return "en route";
  }
  if (status === "onGround") {
    return "on ground";
  }
  if (status === "within100km") {
    return "within 100km of HK";
  }
  if (status === "completed") {
    return "completed";
  }
  return "status unavailable";
}

function directionTitle(direction: DirectionFilter): string {
  if (direction === "arrival") {
    return "Inbound";
  }
  if (direction === "departure") {
    return "Outbound";
  }
  return "Combined inbound + outbound";
}

function directionVolumeLabel(direction: DirectionFilter): string {
  if (direction === "arrival") {
    return "Predicted arrivals in table";
  }
  if (direction === "departure") {
    return "Predicted departures in table";
  }
  return "Predicted arrivals + departures";
}

function directionChartTitle(direction: DirectionFilter): string {
  if (direction === "arrival") {
    return "Predicted inbound flights by hour";
  }
  if (direction === "departure") {
    return "Predicted outbound flights by hour";
  }
  return "Predicted inbound + outbound flights by hour";
}

function buildDashboardUrl(args: {
  force: boolean;
  direction: DirectionFilter;
  traffic: TrafficFilter;
  horizon: HorizonFilter;
}): string {
  const params = new URLSearchParams({
    direction: args.direction,
    traffic: args.traffic,
    horizonHours: String(args.horizon)
  });
  if (args.force) {
    params.set("refresh", "true");
  }
  return `/api/dashboard?${params.toString()}`;
}

function SummaryList({ items }: { items: HorizonAirportSummary[] }) {
  if (items.length === 0) {
    return <p className="empty">No flights in this window.</p>;
  }

  return (
    <div className="summary-list">
      {items.slice(0, 5).map((item) => (
        <div className="summary-item" key={item.airportIata}>
          <div>
            <strong>{item.airportIata}</strong>
            <span>{item.airport?.city ?? "Mapping needed"}</span>
          </div>
          <div className="summary-count">{item.count}</div>
          <div className={`weather-pill ${weatherClass(item.weather?.category)}`}>
            {item.weather
              ? `${item.weather.label}${
                  item.weather.category === "reported" && item.weather.weatherCodes[0]
                    ? ` ${item.weather.weatherCodes[0]}`
                    : ""
                }`
              : "NO DATA"}
          </div>
        </div>
      ))}
    </div>
  );
}

function CellValue({
  row,
  value,
  index
}: {
  row: TableRow;
  value: number | string;
  index: number;
}) {
  const isNumber = typeof value === "number";
  const weatherCategory = row.weatherCategory?.[index];
  return (
    <span className={isNumber ? "number-cell" : `weather-cell ${weatherClass(weatherCategory)}`}>
      {value}
    </span>
  );
}

function OperationsTable({
  data,
  direction
}: {
  data: DashboardData;
  direction: DirectionFilter;
}) {
  return (
    <section className="panel table-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Wallace table</p>
          <h2>{directionTitle(direction)} Flight Situational Awareness</h2>
        </div>
        <div className="table-note">HKT / UTC Z · Auto-refresh 30 min</div>
      </div>
      <div className="table-scroll">
        <table className="ops-table">
          <thead>
            <tr>
              <th className="row-label">Time bucket</th>
              {data.hours.map((hour) => (
                <th key={hour.label}>
                  <span>{hour.label}</span>
                  <small>
                    HKT {formatClock(hour.startsAt)}
                    <br />
                    {formatUtcClock(hour.startsAt)}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.hourlyArrivalTable.map((row, rowIndex) => {
              const previousRegion = data.hourlyArrivalTable[rowIndex - 1]?.region;
              const className = row.region
                ? `region-row${row.region !== previousRegion ? " region-start" : ""}`
                : "metric-row";
              return (
              <tr key={row.id} className={className}>
                <th className="row-label">
                  {row.label}
                  {row.status ? <small>{statusLabel(row.status)}</small> : null}
                </th>
                {row.values.map((value, index) => (
                  <td key={`${row.id}-${data.hours[index]?.label}`}>
                    <CellValue row={row} value={value} index={index} />
                  </td>
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DashboardFilters({
  direction,
  traffic,
  horizon,
  disabled,
  onDirectionChange,
  onTrafficChange,
  onHorizonChange
}: {
  direction: DirectionFilter;
  traffic: TrafficFilter;
  horizon: HorizonFilter;
  disabled: boolean;
  onDirectionChange: (value: DirectionFilter) => void;
  onTrafficChange: (value: TrafficFilter) => void;
  onHorizonChange: (value: HorizonFilter) => void;
}) {
  return (
    <section className="filters" aria-label="Dashboard filters">
      <div className="filter-group">
        <label htmlFor="direction">Direction</label>
        <select
          id="direction"
          value={direction}
          disabled={disabled}
          onChange={(event) => onDirectionChange(event.target.value as DirectionFilter)}
        >
          <option value="both">Both directions</option>
          <option value="arrival">Inbound to HKIA</option>
          <option value="departure">Outbound from HKIA</option>
        </select>
      </div>
      <div className="filter-group">
        <label htmlFor="traffic">Flight type</label>
        <select
          id="traffic"
          value={traffic}
          disabled={disabled}
          onChange={(event) => onTrafficChange(event.target.value as TrafficFilter)}
        >
          <option value="both">Passenger + cargo</option>
          <option value="passenger">Passenger</option>
          <option value="cargo">Cargo</option>
        </select>
      </div>
      <div className="filter-group">
        <label htmlFor="horizon">Table horizon</label>
        <select
          id="horizon"
          value={horizon}
          disabled={disabled}
          onChange={(event) => onHorizonChange(Number(event.target.value) as HorizonFilter)}
        >
          <option value={6}>T(now) to +6</option>
          <option value={12}>T(now) to +12</option>
          <option value={15}>T(now) to +15</option>
          <option value={18}>T(now) to +18</option>
          <option value={24}>T(now) to +24</option>
          <option value={30}>T(now) to +30</option>
        </select>
      </div>
    </section>
  );
}

function getFlightRateRow(data: DashboardData): TableRow | undefined {
  return data.hourlyArrivalTable.find(
    (row) => row.id === "flight-rate" || row.id === "arrival-rate"
  );
}

function SummaryStrip({
  data,
  direction
}: {
  data: DashboardData;
  direction: DirectionFilter;
}) {
  const volumeValues =
    getFlightRateRow(data)?.values.filter(
      (value): value is number => typeof value === "number"
    ) ?? [];
  const totalFlights = volumeValues.reduce((sum, value) => sum + value, 0);
  const peak = volumeValues.reduce(
    (best, value, index) => (value > best.value ? { value, index } : best),
    { value: 0, index: 0 }
  );
  const enRoute = data.flights.filter(
    (flight) => flight.statusNow === "enRoute"
  ).length;
  const within100km = data.flights.filter(
    (flight) => flight.statusNow === "within100km"
  ).length;
  const rangeStart = new Date(data.hours[0]?.startsAt ?? data.generatedAt);
  const rangeEnd = new Date(data.hours.at(-1)?.endsAt ?? data.generatedAt);
  const weatherHits = data.weather.filter((weather) => {
    const metarHit =
      weather.metar?.category === "reported";
    const tafHit = weather.tafPeriods.some(
      (period) =>
        new Date(period.startsAt) < rangeEnd &&
        new Date(period.endsAt) > rangeStart &&
        period.category === "reported"
    );
    return metarHit || tafHit;
  }).length;

  return (
    <section className="summary">
      <div className="summary-card">
        <div className="value">{totalFlights.toLocaleString()}</div>
        <div className="label">{directionVolumeLabel(direction)}</div>
      </div>
      <div className="summary-card">
        <div className="value">{peak.value}</div>
        <div className="label">Peak hour ({data.hours[peak.index]?.label ?? "T"})</div>
      </div>
      <div className="summary-card">
        <div className="value">{enRoute.toLocaleString()}</div>
        <div className="label">Flights estimated en route</div>
      </div>
      <div className="summary-card">
        <div className="value">{within100km.toLocaleString()}</div>
        <div className="label">En-route flights within 100km of HK</div>
      </div>
      <div className="summary-card">
        <div className="value">{weatherHits}</div>
        <div className="label">Priority airports with reported weather</div>
      </div>
    </section>
  );
}

function ArrivalRateChart({
  data,
  direction
}: {
  data: DashboardData;
  direction: DirectionFilter;
}) {
  const values =
    getFlightRateRow(data)?.values.map((value) =>
      typeof value === "number" ? value : 0
    ) ?? [];
  const max = Math.max(1, ...values);

  return (
    <section className="chart-wrap">
      <div className="chart-title">{directionChartTitle(direction)} · HKT / UTC Z</div>
      <div className="bar-chart">
        {values.map((value, index) => (
          <div className="bar-slot" key={data.hours[index]?.label ?? index}>
            <div className="bar-value">{value}</div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ height: `${Math.max(6, (value / max) * 100)}%` }}
              />
            </div>
            <div className="bar-label">
              <span>{data.hours[index]?.label}</span>
              <small>{formatClock(data.hours[index]?.startsAt)}</small>
              <small>{formatUtcClock(data.hours[index]?.startsAt)}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TopAirportsPanel({
  data,
  direction
}: {
  data: DashboardData;
  direction: DirectionFilter;
}) {
  const startsAt = new Date(data.generatedAt);
  const endsAt = new Date(startsAt.getTime() + 30 * 60 * 60 * 1000);
  const counts = new Map<string, HorizonAirportSummary>();
  for (const flight of data.flights) {
    const scheduled = new Date(flight.scheduledTime);
    if (scheduled < startsAt || scheduled >= endsAt) {
      continue;
    }
    const existing = counts.get(flight.routeAirportIata);
    counts.set(flight.routeAirportIata, {
      airportIata: flight.routeAirportIata,
      airport: flight.routeAirport,
      count: (existing?.count ?? 0) + 1,
      weather: existing?.weather ?? null
    });
  }
  const grouped = [...counts.values()].reduce<Record<string, HorizonAirportSummary[]>>(
    (acc, item) => {
      const region: Region = item.airport?.region ?? "Other";
      acc[region] = [...(acc[region] ?? []), item];
      return acc;
    },
    {}
  );
  const scope =
    direction === "arrival"
      ? "arrival origins"
      : direction === "departure"
        ? "departure destinations"
        : "arrival origins + departure destinations";

  return (
    <section className="top30-list">
      <h3>Top {scope} by region · next 30h</h3>
      {REGION_ORDER.map((region) => {
        const items = (grouped[region] ?? []).sort((a, b) => b.count - a.count).slice(0, 5);
        return (
        <div className="region-group" key={region}>
          <div className="region-header">{region}</div>
          <div className="region-items">
            {items.length === 0 ? (
              <span className="empty">No flights in this window.</span>
            ) : items.map((item, index) => (
              <span key={item.airportIata}>
                <b className="rank">#{index + 1}</b>
                <b className="code">{item.airportIata}</b>
                <em className="icao">{item.airport?.icao ?? "----"}</em>
                <small>{item.count} flights</small>
              </span>
            ))}
          </div>
        </div>
        );
      })}
    </section>
  );
}

function MethodologyPanel() {
  const notes = [
    {
      title: "Table criteria",
      text:
        "The rate row counts scheduled HKIA movements matching the selected direction and flight type in each one-hour bucket. Region rows are point-in-time snapshots of all matching active flights at T(now) and each +N forecast time."
    },
    {
      title: "Priority airport",
      text:
        "HKG plus mapped route airports ranked by selected-window flight count; the first 72 are queried for METAR and the first 45 for TAF."
    },
    {
      title: "TAF",
      text:
        "The TAF row uses only AviationWeather forecast periods that overlap each hour. The reported-weather row may include the current METAR at T(now); future columns use applicable TAF periods only."
    },
    {
      title: "Weather categories",
      text:
        "NO DATA means no usable report. NO REPORTED WX means a structured report exists without a weather group, or explicitly contains NSW. REPORTED WX means the source wxString contains one or more weather codes. These are data states, not severity ratings."
    },
    {
      title: "Official weather codes",
      text:
        "HKO defines - as light, + as heavy, VC as vicinity, and codes such as TS (thunderstorms), RA (rain), DZ (drizzle), BR (mist), FG (fog), and HZ (haze). The dashboard displays the exact source code and does not assign a custom severity."
    },
    {
      title: "No invented minima",
      text:
        "Wind, gust, visibility, and cloud values are source observations or forecasts. They are not converted into a flight-impact level because runway, aircraft, operator, and official warning criteria are not present in this dataset."
    },
    {
      title: "Flight status",
      text:
        "Estimated duration = max(1h, great-circle distance / 820 km/h + 0.55h). Within 100km counts every flight estimated airborne and no more than 100km from Hong Kong at that forecast time."
    },
    {
      title: "On ground",
      text:
        "For arrivals, on ground means still at the origin airport. For departures, on ground means still at HKIA before scheduled departure."
    },
    {
      title: "Greater China",
      text: "Greater China includes mainland China, Hong Kong, Macau, and Taiwan."
    },
    {
      title: "Source weather matches",
      text:
        "Cards include selected flights that are active now or scheduled within 30 hours and overlap a route-airport REPORTED WX period. They are sorted by scheduled time; no severity order is inferred."
    },
    {
      title: "Missing data",
      text:
        "Missing airport, distance, METAR, or TAF data is shown as Unknown or NO DATA and reported in the warning banner; it is never treated as no reported weather."
    }
  ];

  return (
    <section className="methodology-panel">
      <div>
        <p className="eyebrow">Methodology</p>
        <h2>How The Wallace Table Is Generated</h2>
      </div>
      <div className="methodology-grid">
        {notes.map((note) => (
          <article key={note.title}>
            <strong>{note.title}</strong>
            <p>{note.text}</p>
          </article>
        ))}
      </div>
      <div className="methodology-sources">
        <strong>Official references</strong>
        <a href="https://www.hko.gov.hk/en/aviat/decode_metar.htm" target="_blank" rel="noreferrer">
          HKO METAR/SPECI decoding
        </a>
        <a href="https://www.hko.gov.hk/en/aviat/decode_taf.htm" target="_blank" rel="noreferrer">
          HKO TAF decoding
        </a>
        <a href="https://aviationweather.gov/data/api/" target="_blank" rel="noreferrer">
          AviationWeather Data API
        </a>
      </div>
    </section>
  );
}

function HorizonCards({ data, direction }: { data: DashboardData; direction: DirectionFilter }) {
  return (
    <section className="horizon-grid">
      {data.horizons.map((horizon) => (
        <article className="panel horizon-card" key={horizon.hours}>
          <div className="horizon-title">
            <span>Next</span>
            <strong>{horizon.hours}h</strong>
          </div>
          {direction !== "departure" ? (
            <>
              <h3>Arrival origins</h3>
              <SummaryList items={horizon.arrivalOrigins} />
            </>
          ) : null}
          {direction !== "arrival" ? (
            <>
              <h3>Departure destinations</h3>
              <SummaryList items={horizon.departureDestinations} />
            </>
          ) : null}
          <h3>Reported-weather matches</h3>
          <SummaryList items={horizon.reportedWeatherAirports} />
        </article>
      ))}
    </section>
  );
}

function weatherAtFlightTime(
  weather: AirportWeather,
  flight: NormalizedFlight,
  generatedAt: Date
): WeatherAssessment {
  const scheduled = new Date(flight.scheduledTime);
  const at = scheduled < generatedAt ? generatedAt : scheduled;
  const endsAt = new Date(at.getTime() + 60 * 60 * 1000);
  const assessments: WeatherAssessment[] = weather.tafPeriods.filter(
    (period) => new Date(period.startsAt) < endsAt && new Date(period.endsAt) > at
  );
  if (at.getTime() - generatedAt.getTime() < 60 * 60 * 1000 && weather.metar) {
    assessments.push(weather.metar);
  }
  const reported = assessments.filter((assessment) => assessment.category === "reported");
  if (reported.length > 0) {
    return {
      category: "reported",
      label: "REPORTED WX",
      reasons: [...new Set(reported.flatMap((assessment) => assessment.reasons))],
      weatherCodes: [...new Set(reported.flatMap((assessment) => assessment.weatherCodes))]
    };
  }
  const available = assessments.find((assessment) => assessment.category === "none");
  return available ?? {
    category: "unknown",
    label: "NO DATA",
    reasons: ["Weather data unavailable"],
    weatherCodes: []
  };
}

function OperationalConcerns({ data }: { data: DashboardData }) {
  const weatherByAirport = new Map(data.weather.map((weather) => [weather.airportIata, weather]));
  const generatedAt = new Date(data.generatedAt);
  const concernEnd = new Date(generatedAt.getTime() + 30 * 60 * 60 * 1000);
  const concerns = data.flights
    .flatMap((flight) => {
      const scheduled = new Date(flight.scheduledTime);
      const activeNow = flight.statusNow === "enRoute" || flight.statusNow === "within100km";
      if (!activeNow && (scheduled < generatedAt || scheduled >= concernEnd)) {
        return [];
      }
      const weather = weatherByAirport.get(flight.routeAirportIata);
      if (!weather) {
        return [];
      }
      const assessment = weatherAtFlightTime(weather, flight, generatedAt);
      return assessment.category === "reported"
        ? [{ flight, assessment }]
        : [];
    })
    .sort(
      (a, b) =>
        new Date(a.flight.scheduledTime).getTime() - new Date(b.flight.scheduledTime).getTime()
    )
    .slice(0, 12);

  return (
    <section className="panel concerns-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Source weather match</p>
          <h2>Flights Matched With Reported Weather</h2>
          <p className="section-description">
            Active or next-30h flights whose route-airport METAR/TAF contains a weather code.
            This is not a severity or operational-impact rating.
          </p>
        </div>
      </div>
      {concerns.length === 0 ? (
        <p className="empty">No reported-weather airport matches in the current 30-hour window.</p>
      ) : (
        <div className="concern-list">
          {concerns.map(({ flight, assessment }) => {
            return (
              <div className="concern-item" key={flight.id}>
                <div>
                  <strong>{flight.flightNumbers[0] ?? "Flight"}</strong>
                  <span>
                    {flight.direction === "arrival" ? "from" : "to"}{" "}
                    {flight.routeAirportIata} at {formatClock(flight.scheduledTime)}
                  </span>
                </div>
                <div className={`weather-pill ${weatherClass(assessment.category)}`}>
                  {assessment.label}
                </div>
                <p>{assessment.reasons.slice(0, 3).join(", ")}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [direction, setDirection] = useState<DirectionFilter>("both");
  const [traffic, setTraffic] = useState<TrafficFilter>("both");
  const [horizon, setHorizon] = useState<HorizonFilter>(15);
  const requestSequence = useRef(0);

  async function loadDashboard(force = false) {
    const requestId = ++requestSequence.current;
    setError(null);
    setLoading(true);
    setRefreshing(force);
    try {
      const response = await fetch(
        buildDashboardUrl({ force, direction, traffic, horizon }),
        { cache: "no-store" }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as DashboardError | null;
        throw new Error(body?.error ?? `Dashboard API ${response.status}`);
      }
      const nextData = (await response.json()) as DashboardData;
      if (requestId !== requestSequence.current) {
        return;
      }
      startTransition(() => {
        setData(nextData);
        setLoading(false);
      });
    } catch (loadError) {
      if (requestId !== requestSequence.current) {
        return;
      }
      setError(String(loadError));
      setLoading(false);
    } finally {
      if (requestId === requestSequence.current) {
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void loadDashboard(false);
    const timer = window.setInterval(() => {
      void loadDashboard(true);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [direction, traffic, horizon]);

  if (loading && !data) {
    return (
      <main className="dashboard-shell loading-shell">
        <div className="loading-card">Loading live HKIA and aviation weather data...</div>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Hong Kong International Airport · VHHH</p>
          <h1>HKIA Flight Weather Dashboard</h1>
        </div>
        <div className="status-card">
          <div>
            <span>Generated</span>
            <strong>{formatDateTime(data?.generatedAt)}</strong>
          </div>
          <div>
            <span>HKIA source</span>
            <strong>{formatDateTime(data?.sourceUpdatedAt)}</strong>
          </div>
          <div>
            <span>Next cache expiry</span>
            <strong>{formatDateTime(data?.cacheExpiresAt)}</strong>
          </div>
          <button type="button" onClick={() => void loadDashboard(true)} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Manual refresh"}
          </button>
        </div>
      </section>

      {error ? <div className="notice error-notice">{error}</div> : null}
      {loading && data ? <div className="notice loading-notice">Updating filtered data...</div> : null}
      {data?.warnings.length ? (
        <div className="notice warning-notice" role="status">
          <strong>Data quality notices</strong>
          {data.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}

      {data ? (
        <>
          <DashboardFilters
            direction={direction}
            traffic={traffic}
            horizon={horizon}
            disabled={refreshing}
            onDirectionChange={setDirection}
            onTrafficChange={setTraffic}
            onHorizonChange={setHorizon}
          />
          <ArrivalRateChart data={data} direction={direction} />
          <SummaryStrip data={data} direction={direction} />
          <TopAirportsPanel data={data} direction={direction} />
          <MethodologyPanel />
          <OperationsTable data={data} direction={direction} />
          <OperationalConcerns data={data} />
          <HorizonCards data={data} direction={direction} />
        </>
      ) : null}
    </main>
  );
}
