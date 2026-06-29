"use client";

import { startTransition, useEffect, useState } from "react";
import type {
  DashboardData,
  HorizonAirportSummary,
  NormalizedFlight,
  TableRow,
  WeatherRiskLevel
} from "@/lib/types";

const REFRESH_MS = 30 * 60 * 1000;
const HKG_POINT = { lat: 22.308, lon: 113.9185 };

function formatDateTime(value?: string): string {
  if (!value) {
    return "Not available";
  }
  return new Intl.DateTimeFormat("en-HK", {
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
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function riskClass(level?: WeatherRiskLevel): string {
  return `risk-${level ?? "nil"}`;
}

function statusLabel(status?: string): string {
  if (status === "enRoute") {
    return "en route";
  }
  if (status === "onLand") {
    return "on land";
  }
  if (status === "within100km") {
    return "within 100km";
  }
  return "unknown";
}

function project(point: { lat: number; lon: number }) {
  return {
    x: ((point.lon + 180) / 360) * 1000,
    y: ((90 - point.lat) / 180) * 470
  };
}

function pathForRoute(route: Array<{ lat: number; lon: number }>): string {
  return route
    .map((point, index) => {
      const projected = project(point);
      return `${index === 0 ? "M" : "L"} ${projected.x.toFixed(1)} ${projected.y.toFixed(1)}`;
    })
    .join(" ");
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

function OperationsTable({ data }: { data: DashboardData }) {
  return (
    <section className="panel table-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Wallace table</p>
          <h2>Flight Situational Awareness</h2>
        </div>
        <div className="table-note">Auto-refresh every 30 min</div>
      </div>
      <div className="table-scroll">
        <table className="ops-table">
          <thead>
            <tr>
              <th className="row-label">Time bucket</th>
              {data.hours.map((hour) => (
                <th key={hour.label}>
                  <span>{hour.label}</span>
                  <small>{formatClock(hour.startsAt)}</small>
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
        <p className="empty">No bad-weather airport matches in the current 24-hour window.</p>
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

function TrajectoryMap({ data }: { data: DashboardData }) {
  const riskByAirport = new Map(data.weather.map((risk) => [risk.airportIata, risk]));
  const flights = data.flights
    .filter((flight) => flight.route.length > 0)
    .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime())
    .slice(0, 90);
  const airportCodes = new Set(flights.map((flight) => flight.routeAirportIata));
  const airports = data.airports.filter(
    (airport) => airport.iata === "HKG" || airportCodes.has(airport.iata)
  );
  const hkg = project(HKG_POINT);

  return (
    <section className="panel map-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">GIS view</p>
          <h2>Estimated Flight Trajectories</h2>
        </div>
        <div className="table-note">Great-circle routes, not live ADS-B tracks</div>
      </div>
      <svg className="world-map" viewBox="0 0 1000 470" role="img">
        <defs>
          <radialGradient id="hkgGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff7b0" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fff7b0" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1000" height="470" rx="28" />
        {[-120, -60, 0, 60, 120].map((lon) => {
          const x = project({ lat: 0, lon }).x;
          return <line className="grid-line" key={`lon-${lon}`} x1={x} x2={x} y1="24" y2="446" />;
        })}
        {[-45, 0, 45].map((lat) => {
          const y = project({ lat, lon: 0 }).y;
          return <line className="grid-line" key={`lat-${lat}`} x1="24" x2="976" y1={y} y2={y} />;
        })}
        <circle className="hkg-glow" cx={hkg.x} cy={hkg.y} r="76" />
        {flights.map((flight) => {
          const risk = riskByAirport.get(flight.routeAirportIata);
          return (
            <path
              className={`route-line ${flight.direction} ${riskClass(risk?.level)}`}
              d={pathForRoute(flight.route)}
              key={flight.id}
            />
          );
        })}
        {airports.map((airport) => {
          const point = project(airport);
          const risk = riskByAirport.get(airport.iata);
          return (
            <g className="airport-marker" key={airport.iata}>
              <circle className={riskClass(risk?.level)} cx={point.x} cy={point.y} r={airport.iata === "HKG" ? 7 : 4} />
              <text x={point.x + 7} y={point.y - 7}>
                {airport.iata}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="map-legend">
        <span><i className="legend-dot arrival" /> arrivals</span>
        <span><i className="legend-dot departure" /> departures</span>
        <span><i className="legend-dot risk-severe" /> bad weather</span>
      </div>
    </section>
  );
}

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadDashboard(force = false) {
    setError(null);
    setRefreshing(force);
    try {
      const response = await fetch(`/api/dashboard${force ? "?refresh=true" : ""}`, {
        cache: "no-store"
      });
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
  }, []);

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
          <p className="eyebrow">Hong Kong Observatory internship first draft</p>
          <h1>HKO Flight Weather Dashboard</h1>
          <p className="hero-copy">
            Arrival-flow awareness for the next operational hours: which flights are
            en route, which are still on land, and where bad weather may affect
            traffic-rate decisions.
          </p>
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
      {data?.warnings.length ? (
        <div className="notice warning-notice">
          <strong>Live-data notes</strong>
          {data.warnings.slice(0, 4).map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}

      {data ? (
        <>
          <OperationsTable data={data} />
          <div className="split-grid">
            <TrajectoryMap data={data} />
            <OperationalConcerns data={data} />
          </div>
          <HorizonCards data={data} />
          <section className="panel flights-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Raw feed sample</p>
                <h2>Upcoming Flights</h2>
              </div>
            </div>
            <div className="flight-list">
              {data.flights.slice(0, 18).map((flight: NormalizedFlight) => (
                <div className="flight-item" key={flight.id}>
                  <strong>{flight.flightNumbers[0] ?? "Unknown"}</strong>
                  <span>{flight.direction}</span>
                  <span>{flight.routeAirportIata}</span>
                  <span>{formatClock(flight.scheduledTime)}</span>
                  <span>{flight.trafficType}</span>
                  <span>{statusLabel(flight.arrivalStatus)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
