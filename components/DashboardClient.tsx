"use client";

import { startTransition, useEffect, useState } from "react";
import type {
  DashboardData,
  HorizonAirportSummary,
  Region,
  TableRow,
  TrafficType,
  WeatherRiskLevel
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

function formatDateTime(value?: string): string {
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

function formatClock(value?: string): string {
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

function formatUtcClock(value?: string): string {
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

function riskClass(level?: WeatherRiskLevel): string {
  return `risk-${level ?? "nil"}`;
}

function statusLabel(status?: string): string {
  if (status === "enRoute") {
    return "en route";
  }
  if (status === "onLand") {
    return "on ground";
  }
  if (status === "within100km") {
    return "within 100km of HK";
  }
  return "unknown";
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
          <div className={`risk-pill ${riskClass(item.weather?.level)}`}>
            {item.weather?.label ?? "NO METAR"}
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
  const severity = row.severity?.[index];
  return (
    <span className={isNumber ? "number-cell" : `weather-cell ${riskClass(severity)}`}>
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
            {data.hourlyArrivalTable.map((row) => (
              <tr key={row.id} className={row.region ? "region-row" : "metric-row"}>
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
            ))}
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
          <option value={6}>Next 6h</option>
          <option value={12}>Next 12h</option>
          <option value={15}>T(now) to +15</option>
          <option value={18}>Next 18h</option>
          <option value={24}>Next 24h</option>
          <option value={30}>Next 30h</option>
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
    (flight) => (flight.flightStatus ?? flight.arrivalStatus) === "enRoute"
  ).length;
  const within100km = data.flights.filter(
    (flight) => (flight.flightStatus ?? flight.arrivalStatus) === "within100km"
  ).length;
  const weatherHits = data.weather.filter((risk) => risk.level !== "nil").length;

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
        <div className="label">Priority airports with bad weather</div>
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

function TopAirportsPanel({ data }: { data: DashboardData }) {
  const latest = data.horizons.find((horizon) => horizon.hours === 30) ?? data.horizons.at(-1);
  const combined = new Map<string, HorizonAirportSummary>();
  for (const item of [
    ...(latest?.arrivalOrigins ?? []),
    ...(latest?.departureDestinations ?? [])
  ]) {
    const existing = combined.get(item.airportIata);
    combined.set(item.airportIata, {
      ...item,
      count: (existing?.count ?? 0) + item.count,
      weather: item.weather ?? existing?.weather
    });
  }

  const grouped = [...combined.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)
    .reduce<Record<string, HorizonAirportSummary[]>>((acc, item) => {
      const region: Region | "Other" = item.airport?.region ?? "Other";
      acc[region] = [...(acc[region] ?? []), item];
      return acc;
    }, {});
  const orderedGroups = REGION_ORDER.flatMap((region) =>
    grouped[region]?.length ? [[region, grouped[region]] as const] : []
  );

  return (
    <section className="top30-list">
      <h3>Top airports to watch for weather · next 30h</h3>
      {orderedGroups.map(([region, items]) => (
        <div className="region-group" key={region}>
          <div className="region-header">{region}</div>
          <div className="region-items">
            {items.map((item, index) => (
              <span key={item.airportIata}>
                <b className="rank">#{index + 1}</b>
                <b className="code">{item.airportIata}</b>
                <em className="icao">{item.airport?.icao ?? "----"}</em>
                <small>{item.count} flights</small>
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function MethodologyPanel() {
  const notes = [
    {
      title: "Table criteria",
      text:
        "Rows include scheduled HKIA flights matching the selected direction and flight type, grouped by one-hour buckets from T(now)."
    },
    {
      title: "Priority airport",
      text:
        "HKG plus route airports ranked by flight count; the busiest mapped airports are queried first for METAR and TAF to keep refresh fast."
    },
    {
      title: "TAF",
      text:
        "The TAF row is forecast-only. The bad-weather row combines METAR observations, available TAF, and affected route airports."
    },
    {
      title: "Severity",
      text:
        "Significant means wind or gust at least 35 kt, visibility below 0.62 SM, ceiling below 1000 ft, or listed hazard weather codes. Severe includes TS, FZ, SQ, FC, VA, SS, and DS."
    },
    {
      title: "Flight status",
      text:
        "En route and within 100km are estimates from schedule, distance, and 820 km/h cruise speed; within 100km only counts flights already estimated airborne near Hong Kong."
    },
    {
      title: "On ground",
      text:
        "For arrivals, on ground means still at the origin airport. For departures, on ground means still at HKIA before scheduled departure."
    },
    {
      title: "Greater China",
      text: "Greater China includes mainland China, Hong Kong, Macau, and Taiwan."
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
    </section>
  );
}

function HorizonCards({ data }: { data: DashboardData }) {
  return (
    <section className="horizon-grid">
      {data.horizons.map((horizon) => (
        <article className="panel horizon-card" key={horizon.hours}>
          <div className="horizon-title">
            <span>Next</span>
            <strong>{horizon.hours}h</strong>
          </div>
          <h3>Arrival origins</h3>
          <SummaryList items={horizon.arrivalOrigins} />
          <h3>Departure destinations</h3>
          <SummaryList items={horizon.departureDestinations} />
          <h3>Bad-weather matches</h3>
          <SummaryList items={horizon.badWeatherAirports} />
        </article>
      ))}
    </section>
  );
}

function OperationalConcerns({ data }: { data: DashboardData }) {
  const riskByAirport = new Map(data.weather.map((risk) => [risk.airportIata, risk]));
  const concerns = data.flights
    .filter((flight) => {
      const risk = riskByAirport.get(flight.routeAirportIata);
      return risk && risk.level !== "nil";
    })
    .slice(0, 12);

  return (
    <section className="panel concerns-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Operational concern</p>
          <h2>Flights Matched With Bad Weather</h2>
        </div>
      </div>
      {concerns.length === 0 ? (
        <p className="empty">No bad-weather airport matches in the current 30-hour window.</p>
      ) : (
        <div className="concern-list">
          {concerns.map((flight) => {
            const risk = riskByAirport.get(flight.routeAirportIata);
            return (
              <div className="concern-item" key={flight.id}>
                <div>
                  <strong>{flight.flightNumbers[0] ?? "Flight"}</strong>
                  <span>
                    {flight.direction === "arrival" ? "from" : "to"}{" "}
                    {flight.routeAirportIata} at {formatClock(flight.scheduledTime)}
                  </span>
                </div>
                <div className={`risk-pill ${riskClass(risk?.level)}`}>
                  {risk?.label ?? "Risk"}
                </div>
                <p>{risk?.reasons.slice(0, 2).join(", ")}</p>
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

  async function loadDashboard(force = false) {
    setError(null);
    setRefreshing(force);
    try {
      const response = await fetch(
        buildDashboardUrl({ force, direction, traffic, horizon }),
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error(`Dashboard API ${response.status}`);
      }
      const nextData = (await response.json()) as DashboardData;
      startTransition(() => {
        setData(nextData);
        setLoading(false);
      });
    } catch (loadError) {
      setError(String(loadError));
      setLoading(false);
    } finally {
      setRefreshing(false);
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
          <TopAirportsPanel data={data} />
          <MethodologyPanel />
          <OperationsTable data={data} direction={direction} />
          <OperationalConcerns data={data} />
          <HorizonCards data={data} />
        </>
      ) : null}
    </main>
  );
}
