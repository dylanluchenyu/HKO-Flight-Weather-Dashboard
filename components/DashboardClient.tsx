"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import type {
  DashboardError,
  DashboardData,
  Region,
  RouteAirportSummary,
  RouteAirportWeatherStatus,
  RouteWeatherMatch,
  RouteWeatherSource,
  TableRow,
  TrafficType
} from "@/lib/types";

const REFRESH_MS = 30 * 60 * 1000;
type DirectionFilter = "both" | "arrival" | "departure";
type TrafficFilter = "both" | TrafficType;
type HorizonFilter = 6 | 12 | 18 | 24 | 30;
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

function weatherStatusClass(status: RouteAirportWeatherStatus): string {
  if (status === "metar" || status === "taf" || status === "metar-taf") {
    return "weather-reported";
  }
  if (status === "none") {
    return "weather-none";
  }
  if (status === "not-queried") {
    return "weather-not-queried";
  }
  return "weather-unknown";
}

function weatherStatusLabel(status: RouteAirportWeatherStatus, codes: string[]): string {
  const suffix = codes.length > 0 ? ` ${codes.slice(0, 2).join("/")}` : "";
  if (status === "metar-taf") {
    return `METAR + TAF${suffix}`;
  }
  if (status === "metar") {
    return `METAR${suffix}`;
  }
  if (status === "taf") {
    return `TAF${suffix}`;
  }
  if (status === "none") {
    return "NO REPORTED WX";
  }
  if (status === "not-queried") {
    return "Not queried";
  }
  return "NO DATA";
}

function windowLabel(horizon: HorizonFilter): string {
  return horizon === 30 ? "next 30h extended window" : `next ${horizon}h`;
}

function directionWindowFlightLabel(direction: DirectionFilter, horizon: HorizonFilter): string {
  if (direction === "arrival") {
    return `Inbound flights in ${windowLabel(horizon)}`;
  }
  if (direction === "departure") {
    return `Outbound flights in ${windowLabel(horizon)}`;
  }
  return `Inbound + outbound flights in ${windowLabel(horizon)}`;
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

function airportDisplayName(item: { airportIata: string; airport: RouteAirportSummary["airport"] }) {
  if (!item.airport) {
    return item.airportIata;
  }
  return item.airport.city === item.airport.name
    ? item.airport.name
    : `${item.airport.city} / ${item.airport.name}`;
}

function airportMeta(item: { airportIata: string; airport: RouteAirportSummary["airport"] }) {
  return `${item.airportIata} · ${item.airport?.icao ?? "----"}`;
}

function directionCountText(item: {
  arrivalCount: number;
  departureCount: number;
  count?: number;
  flightCount?: number;
}) {
  const parts = [];
  if (item.arrivalCount > 0) {
    parts.push(`${item.arrivalCount} inbound`);
  }
  if (item.departureCount > 0) {
    parts.push(`${item.departureCount} outbound`);
  }
  return parts.join(" / ") || `${item.count ?? item.flightCount ?? 0} flights`;
}

function sourceTime(source: RouteWeatherSource): string {
  if (source.kind === "METAR") {
    return `observed ${formatUtcClock(source.observedAt)}`;
  }
  return `${formatUtcClock(source.startsAt)}-${formatUtcClock(source.endsAt)}`;
}

function sourceLabel(source: RouteWeatherSource): string {
  const codes = source.weatherCodes.length > 0 ? source.weatherCodes.join("/") : "reported wx";
  const notes = [source.changeIndicator, source.probability ? `PROB${source.probability}` : null]
    .filter(Boolean)
    .join(" · ");
  return `${source.kind} ${codes} · ${sourceTime(source)}${notes ? ` · ${notes}` : ""}`;
}

function situationCellClass(row: DashboardData["flightSituationRows"][number], index: number) {
  if (row.kind === "phase") {
    return "situation-cell situation-cell-phase";
  }
  const tone = row.tones?.[index] ?? "plain";
  return `situation-cell situation-cell-${tone}`;
}

function situationCellTitle(
  row: DashboardData["flightSituationRows"][number],
  value: string | number,
  hour: DashboardData["situationHours"][number] | undefined
) {
  const label = String(value);
  const time = hour ? `${hour.label} · ${formatClock(hour.startsAt)} HKT` : "";
  const prefix = row.kind === "convection" && label !== "NIL" ? "Full weather indicator: " : "";
  return [time, `${prefix}${label}`].filter(Boolean).join("\n");
}

function renderSituationCell(row: DashboardData["flightSituationRows"][number], value: string | number) {
  const label = String(value);
  if (row.kind !== "convection" || label === "NIL" || label === "NO DATA") {
    return label;
  }

  const compact = label
    .replace(/\bgust\s+(\d+)kt\b/i, "G$1")
    .replace(/\s+/g, " ")
    .trim();
  const [note, ...rest] = compact.split(" ");
  if (rest.length === 0) {
    return <span className="situation-status-main">{compact}</span>;
  }
  const statusLines = rest.join(" ").split("/");
  return (
    <>
      <span className="situation-status-note">{note}</span>
      {statusLines.map((line) => (
        <span className="situation-status-main" key={line}>
          {line}
        </span>
      ))}
    </>
  );
}

function FlightSituationTable({ data }: { data: DashboardData }) {
  return (
    <section className="situation-panel">
      <div className="situation-titlebar">
        <div className="situation-generated">{formatDateTime(data.generatedAt)} HKT</div>
        <h2>Flight Situational Awareness real-time Dashboard</h2>
        <div className="situation-refresh">auto-refresh every 30min</div>
      </div>
      <div className="situation-layout">
        <div className="situation-side-label">predicted number of arriving flight</div>
        <div className="situation-scroll">
          <table className="situation-table">
            <thead>
              <tr>
                <th className="situation-row-label" />
                {data.situationHours.map((hour) => (
                  <th key={hour.label} title={`${formatClock(hour.startsAt)} HKT`}>
                    {hour.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.flightSituationRows.map((row) => (
                <tr className={`situation-row situation-row-${row.kind}`} key={row.id}>
                  <th className="situation-row-label">{row.label}</th>
                  {row.values.map((value, index) => (
                    <td
                      className={situationCellClass(row, index)}
                      key={`${row.id}-${data.situationHours[index]?.label}`}
                      title={situationCellTitle(row, value, data.situationHours[index])}
                    >
                      {renderSituationCell(row, value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="situation-explain">
        <span>
          Arrival rate is predicted from HKIA scheduled arrivals for each one-hour interval.
        </span>
        <span>
          In-air, on-land, and within-100km rows are estimated from schedule time and route
          distance, not live aircraft positions.
        </span>
        <span>
          Deep convection status uses VHHH METAR for T(now) and overlapping TAF periods for future
          columns; it is not an official alert or severity rating.
        </span>
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
        <label htmlFor="horizon">Time window</label>
        <select
          id="horizon"
          value={horizon}
          disabled={disabled}
          onChange={(event) => onHorizonChange(Number(event.target.value) as HorizonFilter)}
        >
          <option value={6}>T(now) to +6</option>
          <option value={12}>T(now) to +12</option>
          <option value={18}>T(now) to +18</option>
          <option value={24}>T(now) to +24</option>
          <option value={30}>T(now) to +30 extended</option>
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
  direction,
  horizon
}: {
  data: DashboardData;
  direction: DirectionFilter;
  horizon: HorizonFilter;
}) {
  const totalFlights = data.routeAirportSummaries.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="summary">
      <div className="summary-card">
        <div className="value">{totalFlights.toLocaleString()}</div>
        <div className="label">{directionWindowFlightLabel(direction, horizon)}</div>
      </div>
      <div className="summary-card">
        <div className="value">{data.routeAirportSummaries.length.toLocaleString()}</div>
        <div className="label">Route airports in {windowLabel(horizon)}</div>
      </div>
      <div className="summary-card">
        <div className="value">{data.routeWeatherMatches.length.toLocaleString()}</div>
        <div className="label">Route airports matched to METAR/TAF weather</div>
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
      <div className="chart-title">{directionChartTitle(direction)} · HKT / UTC (Z)</div>
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
  direction,
  horizon
}: {
  data: DashboardData;
  direction: DirectionFilter;
  horizon: HorizonFilter;
}) {
  const grouped = data.routeAirportSummaries.reduce<Record<string, RouteAirportSummary[]>>(
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
      <h3>Top 10 {scope} by region · {windowLabel(horizon)}</h3>
      {REGION_ORDER.map((region) => {
        const items = (grouped[region] ?? []).sort((a, b) => b.count - a.count).slice(0, 10);
        return (
        <div className="region-group" key={region}>
          <div className="region-header">{region}</div>
          <div className="region-items">
            {items.length === 0 ? (
              <span className="empty">No flights in this window.</span>
            ) : items.map((item, index) => (
              <article className="route-airport-item" key={item.airportIata}>
                <b className="rank">#{index + 1}</b>
                <div className="airport-main">
                  <strong>{airportDisplayName(item)}</strong>
                  <small>
                    {airportMeta(item)} · {item.count} flights · {directionCountText(item)}
                  </small>
                </div>
                <div className={`weather-pill ${weatherStatusClass(item.weatherStatus)}`}>
                  {weatherStatusLabel(item.weatherStatus, item.weatherCodes)}
                </div>
              </article>
            ))}
          </div>
        </div>
        );
      })}
    </section>
  );
}

function RouteAirportWeatherMatches({
  data,
  horizon
}: {
  data: DashboardData;
  horizon: HorizonFilter;
}) {
  return (
    <section className="panel concerns-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Route airport weather match</p>
          <h2>Route Airport Weather Matches</h2>
          <p className="section-description">
            Current-window route airports whose METAR observation or TAF forecast contains a
            weather code. This is not a severity or operational-impact rating.
          </p>
        </div>
      </div>
      {data.routeWeatherMatches.length === 0 ? (
        <p className="empty">No METAR/TAF weather-code matches in the {windowLabel(horizon)}.</p>
      ) : (
        <div className="concern-list">
          {data.routeWeatherMatches.map((match: RouteWeatherMatch) => {
            const visibleSources = match.sources.slice(0, 4);
            const hiddenCount = match.sources.length - visibleSources.length;
            return (
              <div className="concern-item" key={match.airportIata}>
                <div>
                  <strong>{airportDisplayName(match)}</strong>
                  <span>
                    {airportMeta(match)} · {match.flightCount} flights · {directionCountText(match)}
                  </span>
                </div>
                <div className="weather-pill weather-reported">
                  {[...new Set(match.sources.map((source) => source.kind))].join(" + ")}
                </div>
                <div className="match-source-list">
                  {visibleSources.map((source, index) => (
                    <p className="match-source" key={`${match.airportIata}-${source.kind}-${index}`}>
                      <strong>{sourceLabel(source)}</strong>
                      <span>{source.reasons.slice(0, 2).join(", ")}</span>
                    </p>
                  ))}
                  {hiddenCount > 0 ? (
                    <p className="match-source">+{hiddenCount} more TAF periods</p>
                  ) : null}
                </div>
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
  const [horizon, setHorizon] = useState<HorizonFilter>(12);
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
          <SummaryStrip data={data} direction={direction} horizon={horizon} />
          <TopAirportsPanel data={data} direction={direction} horizon={horizon} />
          <FlightSituationTable data={data} />
          <RouteAirportWeatherMatches data={data} horizon={horizon} />
        </>
      ) : null}
    </main>
  );
}
