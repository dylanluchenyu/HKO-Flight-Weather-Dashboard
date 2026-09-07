"use client";

import { Fragment, startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  DashboardError,
  DashboardData,
  OperationalRiskLevel,
  Region,
  RouteAirportSummary,
  RouteAirportWeatherStatus,
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
const TAF_DECODE_URL = "https://www.hko.gov.hk/en/aviat/taf_decode.htm";
const FR24_DISRUPTION_URL = "https://www.flightradar24.com/data/airport-disruption";
const RISK_ORDER: Record<OperationalRiskLevel, number> = {
  high: 0,
  medium: 1,
  low: 2,
  unavailable: 3
};

function CollapsiblePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="dashboard-disclosure">
      <summary>
        <span className="disclosure-arrow" aria-hidden="true">▶</span>
        <span className="disclosure-title">
          <h2>{title}</h2>
          <small>Click the triangle or title to expand or collapse.</small>
        </span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

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

function situationTimeslotLabel(hour: DashboardData["situationHours"][number] | undefined): string {
  if (!hour) {
    return "";
  }
  return `${formatClock(hour.startsAt)}-${formatClock(hour.endsAt)} HKT / ${formatUtcClock(
    hour.startsAt
  )}-${formatUtcClock(hour.endsAt)}`;
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
  return "NO DATA";
}

function windowLabel(horizon: HorizonFilter): string {
  return horizon === 30 ? "next 30h extended window" : `next ${horizon}h`;
}

function routeAirportScope(direction: DirectionFilter): string {
  return direction === "arrival"
    ? "arrival origins"
    : direction === "departure"
      ? "departure destinations"
      : "arrival origins + departure destinations";
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

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${Math.round(value)}%`;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function trendLabel(value: DashboardData["operationalTotals"]["trend"]): string {
  if (value === "worse") {
    return "Getting worse";
  }
  if (value === "recovering") {
    return "Recovering";
  }
  if (value === "persistent") {
    return "Persistent";
  }
  if (value === "stable") {
    return "Stable";
  }
  return "Unavailable";
}

function riskLabel(value: OperationalRiskLevel): string {
  return value === "unavailable"
    ? "Unavailable"
    : value.charAt(0).toUpperCase() + value.slice(1);
}

function operationalCount(
  status: DashboardData["operationalTotals"]["status"],
  value: number
): string {
  return status === "available" ? formatCount(value) : "N/A";
}

function tafTimelineCellClass(cell: DashboardData["routeAirportTafTimelines"][number]["cells"][number]) {
  return `taf-cell taf-cell-${cell.tone}`;
}

function tafTimelineCellTitle(
  cell: DashboardData["routeAirportTafTimelines"][number]["cells"][number]
) {
  return [
    `${formatClock(cell.startsAt)}-${formatClock(cell.endsAt)} HKT / ${formatUtcClock(
      cell.startsAt
    )}-${formatUtcClock(cell.endsAt)}`,
    cell.summary.replace(/\n/g, " · "),
    ...cell.details
  ].join("\n");
}

function situationCellClass(row: DashboardData["flightSituationRows"][number], index: number) {
  if (row.kind === "phase") {
    return "situation-cell situation-cell-phase";
  }
  if (row.kind === "taf") {
    return "situation-cell situation-cell-taf";
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
  const time = hour ? `${hour.label} · ${situationTimeslotLabel(hour)}` : "";
  const prefix =
    row.kind === "convection"
      ? label !== "NIL"
        ? "Full weather indicator: "
        : ""
      : row.kind === "taf"
        ? "HKG TAF significant weather: "
        : "";
  const printable = label.replace(/\n/g, " · ");
  return [time, `${prefix}${printable}`].filter(Boolean).join("\n");
}

function renderSituationCell(row: DashboardData["flightSituationRows"][number], value: string | number) {
  const label = String(value);
  if (row.kind === "taf") {
    return label;
  }
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
        <div className="situation-generated">
          <span>Generated</span>
          {formatDateTime(data.generatedAt)} HKT
        </div>
        <div className="situation-title-copy">
          <h2>Flight Situational Awareness real-time Dashboard</h2>
          <small>
            A fixed 16-hour arrival view combining scheduled counts, estimated flight phases,
            a current observation, and forecasts.
          </small>
        </div>
        <div className="situation-refresh">
          <span>auto-refresh every 30 min</span>
          <small>The dashboard requests source data again on this cycle.</small>
        </div>
      </div>
      <OperationalPast6Cards data={data} />
      <div className="situation-layout">
        <div className="situation-side-label">predicted number of arriving flights</div>
        <div
          className="situation-scroll"
          role="region"
          aria-label="Flight situation table; scroll horizontally for later hours"
          tabIndex={0}
        >
          <table className="situation-table">
            <thead>
              <tr>
                <th className="situation-row-label situation-timeslot-title">
                  predicted arrival timeslot
                  <small>HKT / UTC (Z)</small>
                </th>
                {data.situationHours.map((hour) => (
                  <th
                    className="situation-timeslot"
                    key={hour.label}
                    title={situationTimeslotLabel(hour)}
                  >
                    <span>{formatClock(hour.startsAt)}</span>
                    <small>{formatUtcClock(hour.startsAt)}</small>
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
        <strong>How to read this table</strong>
        <span>
          Predicted flight arrival rate counts HKIA scheduled arrival records in each one-hour
          interval; it is not an actual landed-flight count.
        </span>
        <span>
          On land, en route, and within 100 km are estimates based on scheduled arrival time,
          route distance, an assumed 820 km/h cruise speed, and a 0.55-hour buffer. They are not
          live aircraft positions.
        </span>
        <span>
          Only arrivals scheduled inside this table window are included in the regional rows.
          En route means estimated airborne and more than 100 km from Hong Kong; within 100 km
          is counted separately; on land means estimated not yet airborne at the origin.
        </span>
        <span>
          Deep convection status uses the latest VHHH METAR observation for the first column and
          overlapping VHHH TAF forecast periods for future columns. NIL means no thunderstorm,
          shower, heavy-weather, squall/funnel-cloud code, or gust of at least 30 kt matched; it is
          not an official alert or severity rating.
        </span>
        <span>
          HKG TAF significant weather shows forecast thunderstorm/heavy weather and selected
          aviation hazards, visibility below 5 km, cloud ceiling below 1,500 ft, or gusts of at
          least 30 kt. In a cell, VIS means visibility, CIG cloud ceiling, G gust, kt knots, and ft
          feet. HKT is Hong Kong Time; UTC (Z) is Coordinated Universal Time.{" "}
          <a href={TAF_DECODE_URL} target="_blank" rel="noreferrer">
            Hong Kong Observatory TAF decode
          </a>
          {" "}opens the Hong Kong Observatory decoding guide in a new tab.
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
        <label htmlFor="direction">
          Direction
          <small>
            Changes the chart, summary, Top 10 and route-airport TAF. Operational
            insights, ranking, and the 16-hour situation table stay inbound.
          </small>
        </label>
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
        <label htmlFor="traffic">
          Flight type
          <small>
            Filters HKIA schedule counts and which arrival origins are checked. External
            airport-wide operational statistics are separate from these passenger/cargo counts.
          </small>
        </label>
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
        <label htmlFor="horizon">
          Time window
          <small>
            T(now) starts at the dashboard generation time. This changes current-window panels but
            not the fixed 16-hour situation table; 30h is the beyond-24-hour extended view.
          </small>
        </label>
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
  const ops = data.operationalTotals;

  return (
    <section className="summary">
      <div className="summary-card">
        <div className="value">{totalFlights.toLocaleString()}</div>
        <div className="label">{directionWindowFlightLabel(direction, horizon)}</div>
        <small>HKIA scheduled records matching the direction and flight-type filters.</small>
      </div>
      <div className="summary-card">
        <div className="value">{data.routeAirportSummaries.length.toLocaleString()}</div>
        <div className="label">Route airports in {windowLabel(horizon)}</div>
        <small>
          Number of distinct origin airports for inbound flights and destination airports for
          outbound flights scheduled in this window. Each airport is counted once.
        </small>
      </div>
      <div className="summary-card">
        <div className="value">{data.routeWeatherMatches.length.toLocaleString()}</div>
        <div className="label">Route airports matched to METAR/TAF weather</div>
        <small>Airports with at least one reported or forecast weather code.</small>
      </div>
      <div className="summary-card">
        <div className="value">{formatCount(ops.totalAirports)}</div>
        <div className="label">Arrival origin airports in the selected window</div>
        <small>Distinct origins in the HKIA arrival schedule; not a provider coverage count.</small>
      </div>
      <div className="summary-card">
        <div className="value">{operationalCount(ops.status, ops.affectedFlights)}</div>
        <div className="label">Total affected origin-airport departures</div>
        <small>
          Flightradar24 operational data is not connected; N/A means unavailable, not zero.
        </small>
      </div>
      <div className="summary-card">
        <div className="value">
          {operationalCount(ops.status, ops.delayedFlights)} /{" "}
          {operationalCount(ops.status, ops.cancelledFlights)}
        </div>
        <div className="label">Total delayed / cancelled flights</div>
        <small>Awaiting an authorised Flightradar24 airport delay/cancellation data feed.</small>
      </div>
    </section>
  );
}

function OperationalPast6Cards({ data }: { data: DashboardData }) {
  const totals = data.operationalTotals;
  const pastUnavailable = totals.past6Status === "unavailable";
  const currentUnavailable = totals.status === "unavailable";

  return (
    <div className="ops-context-wrap">
      <div className="ops-context-grid" aria-label="Past 6 Hours operational context">
        <article className="ops-context-card">
          <span>Past 6 Hours</span>
          <strong>
            {pastUnavailable
              ? "Unavailable"
              : `${formatCount(totals.past6AffectedFlights)} affected`}
          </strong>
          <small>
            {pastUnavailable
              ? "Flightradar24 six-hour history is not connected"
              : `${formatCount(totals.past6DelayedFlights)} delayed · ${formatCount(
                  totals.past6CancelledFlights
                )} cancelled`}
          </small>
        </article>
        <article className="ops-context-card">
          <span>Current selected window</span>
          <strong>
            {currentUnavailable ? "Unavailable" : `${formatCount(totals.affectedFlights)} affected`}
          </strong>
          <small>
            {currentUnavailable
              ? "Flightradar24 operational statistics are not connected"
              : `${formatPercent(totals.delayRate)} delay · ${formatPercent(
                  totals.cancellationRate
                )} cancel`}
          </small>
        </article>
        <article className={`ops-context-card trend-${totals.trend}`}>
          <span>Affected-rate trend</span>
          <strong>{trendLabel(totals.trend)}</strong>
          <small>
            {totals.status === "available"
              ? `${formatCount(totals.availableAirports)} of ${formatCount(
                  totals.totalAirports
                )} airports have usable data`
              : "Trend needs both current and past-six-hour data; neither feed is connected."}
          </small>
        </article>
      </div>
      <p className="module-help ops-trend-help">
        Trend compares the affected-flight percentage in the past six hours with the current
        selected window. Getting worse or Recovering requires a change of at least 5 percentage
        points; Persistent means both periods are affected without that change.
        Flightradar24 historical data is not connected. Its public daily figures must not be
        interpreted as a six-hour sample.
      </p>
    </div>
  );
}

function ArrivalOriginOperationalInsights({
  data,
  horizon
}: {
  data: DashboardData;
  horizon: HorizonFilter;
}) {
  const insights = data.arrivalOriginOperationalInsights;
  const ops = data.operationalTotals;

  return (
    <section className="panel operational-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Origin-airport operational insight</p>
          <h2>Arrival Origin Operational Insights</h2>
          <p className="section-description">
            Origins are selected from HKIA arrivals in the {windowLabel(horizon)}.
            Flightradar24 is the requested operational source, but its airport delay/cancellation
            feed is not connected. The public tracking API does not provide the schedules and
            cancellation records needed here. N/A does not mean no delay.
          </p>
        </div>
        <div className="heading-note">
          <span className="table-note">Requested source: Flightradar24</span>
          <small>
            {ops.status === "unavailable"
              ? "Operational sample unavailable"
              : ops.availableAirports === ops.totalAirports
                ? `Full coverage: ${formatCount(ops.totalAirports)} of ${formatCount(
                    ops.totalAirports
                  )} origins`
                : `Partial coverage: ${formatCount(ops.availableAirports)} of ${formatCount(
                    ops.totalAirports
                  )} origins`}
          </small>
        </div>
      </div>
      <p className="module-help provider-source-help">
        <a href={FR24_DISRUPTION_URL} target="_blank" rel="noreferrer">
          Check Flightradar24 airport disruptions
        </a>{" "}
        opens the source website in a new tab. Its published daily statistics are not imported
        into this dashboard or treated as hourly / Past 6 Hours data.
      </p>
      <div className="ops-total-strip">
        <div>
          <span>Arrival origin airports</span>
          <strong>{formatCount(ops.totalAirports)}</strong>
          <small>Distinct origins in the selected HKIA schedule.</small>
        </div>
        <div>
          <span>Total flights sampled</span>
          <strong>{operationalCount(ops.status, ops.totalFlights)}</strong>
          <small>No authorised Flightradar24 schedule denominator is connected yet.</small>
        </div>
        <div>
          <span>Total delayed</span>
          <strong>{operationalCount(ops.status, ops.delayedFlights)}</strong>
          <small>Unavailable until the source supplies delay counts and their definition.</small>
        </div>
        <div>
          <span>Total cancelled</span>
          <strong>{operationalCount(ops.status, ops.cancelledFlights)}</strong>
          <small>Unavailable until the source supplies cancellation records.</small>
        </div>
        <div>
          <span>Affected arrival origins</span>
          <strong>{operationalCount(ops.status, ops.affectedRoutes)}</strong>
          <small>Origins with at least one affected airport-wide departure.</small>
        </div>
      </div>
      {insights.length === 0 ? (
        <p className="empty operational-empty">No HKIA arrival origin airports in this window.</p>
      ) : (
        <div
          className="operational-table-scroll"
          role="region"
          aria-label="Arrival origin operational insights table; scroll for more origins"
          tabIndex={0}
        >
          <table className="operational-table">
            <thead>
              <tr>
                <th>Airport<small>Arrival origin</small></th>
                <th>HKIA arrivals<small>Scheduled to Hong Kong</small></th>
                <th>Delay rate<small>Flightradar24 feed required</small></th>
                <th>Cancel rate<small>Flightradar24 feed required</small></th>
                <th>Affected<small>Distinct delayed or cancelled</small></th>
                <th>Past 6h<small>Previous six hours</small></th>
                <th>Trend<small>Change in affected-flight rate</small></th>
                <th>Time window<small>Hong Kong Time</small></th>
              </tr>
            </thead>
            <tbody>
              {insights.map((item) => (
                <tr key={item.airportIata}>
                  <th>
                    <strong>{airportDisplayName(item)}</strong>
                    <small>{airportMeta(item)}</small>
                  </th>
                  <td>{formatCount(item.routeFlightCount)}</td>
                  <td>{formatPercent(item.current.delayRate)}</td>
                  <td>{formatPercent(item.current.cancellationRate)}</td>
                  <td>
                    {item.current.status === "available"
                      ? `${formatCount(item.current.affectedFlights)} / ${formatCount(
                          item.current.totalFlights
                        )}`
                      : "Unavailable"}
                  </td>
                  <td>
                    {item.past6.status === "available"
                      ? `${formatCount(item.past6.affectedFlights)} affected`
                      : "Unavailable"}
                  </td>
                  <td>
                    <span className={`trend-pill trend-${item.trend}`}>{trendLabel(item.trend)}</span>
                  </td>
                  <td>
                    <small>
                      {formatClock(item.current.windowStart)}-{formatClock(item.current.windowEnd)} HKT
                    </small>
                    {item.current.unavailableReason ? (
                      <small title={item.current.unavailableReason}>Flightradar24 feed not connected.</small>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HourlyRouteAirportRanking({
  data,
  horizon
}: {
  data: DashboardData;
  horizon: HorizonFilter;
}) {
  const [hourFilter, setHourFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState<OperationalRiskLevel | "all">("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("risk");
  const opsAvailable = data.operationalTotals.status === "available";

  useEffect(() => {
    if (
      hourFilter !== "all" &&
      !data.hours.some((hour) => hour.hourOffset === Number(hourFilter))
    ) {
      setHourFilter("all");
    }
  }, [data.hours, hourFilter]);

  const query = search.trim().toUpperCase();
  const rows = data.hourlyRouteAirportRanking
    .filter((row) => hourFilter === "all" || row.hourOffset === Number(hourFilter))
    .filter((row) => riskFilter === "all" || row.riskLevel === riskFilter)
    .filter((row) => {
      if (!query) {
        return true;
      }
      return (
        row.airportIata.includes(query) ||
        row.route.includes(query) ||
        airportDisplayName(row).toUpperCase().includes(query)
      );
    })
    .sort((a, b) => {
      if (sortBy === "affected") {
        return b.affectedFlights - a.affectedFlights;
      }
      if (sortBy === "delay") {
        return (b.delayRate ?? -1) - (a.delayRate ?? -1);
      }
      if (sortBy === "cancel") {
        return (b.cancellationRate ?? -1) - (a.cancellationRate ?? -1);
      }
      if (sortBy === "flights") {
        return b.flightCount - a.flightCount;
      }
      if (sortBy === "airport") {
        return a.airportIata.localeCompare(b.airportIata);
      }
      return (
        RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel] ||
        b.affectedFlights - a.affectedFlights ||
        a.airportIata.localeCompare(b.airportIata)
      );
    })
    .slice(0, 80);

  return (
    <section className="panel ranking-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Hourly route ranking</p>
          <h2>Hourly Route Airport Ranking</h2>
          <p className="section-description">
            Each row represents an origin with an HKIA arrival scheduled in that hour. Ranking
            shows that Hong Kong route count and AviationWeather conditions. Flightradar24
            operational data is not connected, so delay, cancellation and risk remain unavailable.
            A public daily airport statistic cannot be substituted for this hourly view.
          </p>
        </div>
        <div className="heading-note">
          <span className="table-note">{formatCount(rows.length)} visible rows</span>
          <small>At most 80 matching rows are displayed.</small>
        </div>
      </div>
      <div className="ranking-controls">
        <label>
          <span>Hour</span>
          <select value={hourFilter} onChange={(event) => setHourFilter(event.target.value)}>
            <option value="all">All hours</option>
            {data.hours.map((hour) => (
              <option value={hour.hourOffset} key={hour.label}>
                {hour.label} · {formatClock(hour.startsAt)}
              </option>
            ))}
          </select>
          <small>Choose one predicted arrival hour or show all hours.</small>
        </label>
        <label>
          <span>Risk</span>
          <select
            value={riskFilter}
            onChange={(event) => setRiskFilter(event.target.value as OperationalRiskLevel | "all")}
          >
            <option value="all">All risk levels</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="unavailable">Unavailable</option>
          </select>
          <small>Filters by the dashboard-defined threshold level below.</small>
        </label>
        <label>
          <span>Sort</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="risk">Risk level</option>
            <option value="affected">Affected flights</option>
            <option value="delay">Delay rate</option>
            <option value="cancel">Cancellation rate</option>
            <option value="flights">Route flights</option>
            <option value="airport">Airport</option>
          </select>
          <small>Reorders visible rows without requesting new data.</small>
        </label>
        <label>
          <span>Airport / route</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="e.g. HND or HND → HKG"
          />
          <small>Enter a three-letter airport code, route such as HND → HKG, or airport name.</small>
        </label>
      </div>
      <div className="module-legend ranking-legend">
        <p>
          <strong>Risk rule:</strong> High if cancel rate is at least 10%, delay rate at least 50%,
          affected flights at least 5, an alert-colour weather condition is present, or visibility
          is below 1.5 km. Medium uses cancel rate above 0%, delay rate at least 25%, affected
          flights at least 2, a caution-colour weather condition, or visibility below 5 km. Low
          means none of those thresholds were met.
        </p>
        <p>
          <strong>Unavailable:</strong> Flightradar24 operational data is not connected, so no risk level is
          assigned even if weather is present. Current provider state: {opsAvailable ? "available" : "unavailable"}.
        </p>
        <p>
          <strong>Weather and units:</strong> The first hour prefers the latest METAR observation
          and falls back to overlapping TAF when METAR is unavailable; future hours use overlapping
          TAF forecasts. VIS means visibility: below 5 km, show the source miles (sm) and detailed
          kilometres; from 5 to 10 km, show kilometres only; above 10 km, show &gt;10 km.
          “&gt;” means greater than; “≥” means at least; “&lt;” means less than.
          Source bounds are preserved. VIS -- means missing, not zero. “No weather code” does not by itself
          confirm good weather.
        </p>
        <p>Scroll inside the table to review more matching ranking rows.</p>
      </div>
      {rows.length === 0 ? (
        <p className="empty operational-empty">No route-airport ranking rows match the filters.</p>
      ) : (
        <div
          className="operational-table-scroll"
          role="region"
          aria-label="Hourly route airport ranking table; scroll for more rows"
          tabIndex={0}
        >
          <table className="operational-table ranking-table">
            <thead>
              <tr>
                <th>Hour<small>Predicted arrival slot</small></th>
                <th>Route<small>Origin → Hong Kong</small></th>
                <th>Airport<small>Origin airport</small></th>
                <th>Flights<small>HKIA arrival records</small></th>
                <th>Delay<small>Flightradar24 feed required</small></th>
                <th>Cancel<small>Flightradar24 feed required</small></th>
                <th>Affected<small>Operational data required</small></th>
                <th>VIS<small>Detail below 5 km</small></th>
                <th>Weather<small>Source weather codes</small></th>
                <th>Risk<small>Dashboard rule, not official</small></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{data.hours[row.hourOffset]?.label ?? `+${row.hourOffset}h`}</strong>
                    <small>{formatClock(row.startsAt)} HKT</small>
                  </td>
                  <td>{row.route}</td>
                  <td>
                    <strong>{airportDisplayName(row)}</strong>
                    <small>{airportMeta(row)}</small>
                  </td>
                  <td>{formatCount(row.flightCount)}</td>
                  <td>{formatPercent(row.delayRate)}</td>
                  <td>{formatPercent(row.cancellationRate)}</td>
                  <td>{row.riskLevel === "unavailable" ? "N/A" : formatCount(row.affectedFlights)}</td>
                  <td>{row.visibilityLabel}</td>
                  <td>
                    {row.weatherCodes.length > 0
                      ? row.weatherCodes.slice(0, 2).join("/")
                      : "No weather code"}
                  </td>
                  <td>
                    <span className={`risk-pill risk-${row.riskLevel}`}>
                      {riskLabel(row.riskLevel)}
                    </span>
                    <small>{row.riskReasons.slice(0, 2).join(" · ")}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
    <section
      className="chart-wrap"
      role="region"
      aria-label="Scheduled flights by hour chart; scroll horizontally for more hours"
      tabIndex={0}
    >
      <div className="chart-title">{directionChartTitle(direction)} · HKT / UTC (Z)</div>
      <p className="module-help chart-help">
        The horizontal axis shows consecutive one-hour timeslots in Hong Kong Time and UTC. The
        number above each blue bar and the bar height both show the HKIA scheduled-flight count for
        that slot. Heights are scaled against the busiest visible hour; a zero value keeps a small
        baseline so the slot remains visible. Taller bars mean more scheduled traffic, not more
        delay.
      </p>
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
  const scope = routeAirportScope(direction);

  return (
    <section className="top30-list">
      <h3>Top 10 {scope} by region · {windowLabel(horizon)}</h3>
      <p className="module-help top-airports-help">
        “Route airport” means the origin airport for an inbound flight and the destination airport
        for an outbound flight. Airports are ranked by selected-window HKIA scheduled records.
        A three-letter code is the commonly used airport code (IATA); a four-letter code is the
        aviation location code (ICAO).
      </p>
      <div className="module-legend compact-legend">
        <p><strong>METAR</strong> is a current aerodrome observation.</p>
        <p><strong>TAF</strong> is an aerodrome forecast.</p>
        <p><strong>NO REPORTED WX</strong> means a usable report has no encoded weather group.</p>
        <p><strong>NO DATA</strong> means no usable report was returned.</p>
        <p>Every route airport with a known aviation location code is queried for METAR and TAF;
          no airport is skipped because of flight rank or loading limits.</p>
      </div>
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

function RouteAirportTafPanel({
  data,
  horizon
}: {
  data: DashboardData;
  horizon: HorizonFilter;
}) {
  const timelines = data.routeAirportTafTimelines ?? [];

  return (
    <section className="panel taf-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Route-airport TAF forecast</p>
          <h2>Hourly Route Airport TAF</h2>
          <p className="section-description">
            Hour-by-hour Terminal Aerodrome Forecast (TAF) for selected-window route airports.
            Each cell uses structured forecast periods from AviationWeather, not text guessed from
            the raw report.
          </p>
        </div>
        <div className="heading-note">
          <span className="table-note">HKT / UTC (Z)</span>
          <small>Hong Kong Time / Coordinated Universal Time</small>
        </div>
      </div>
      <div className="module-legend taf-legend">
        <p>
          <strong>Cell order:</strong> change group; weather code or NSW; wind; VIS; cloud. BASE is
          the base forecast, FM means “from”, BECMG “becoming”, TEMPO “temporary”, and PROB30/40 a
          30%/40% probability. NSW means no significant weather code in that forecast group; the
          dashboard also uses NSW when the structured source group has no weather code.
        </p>
        <p>
          <strong>Units and codes:</strong> kt is knots, G is gust, VIS is visibility, sm is statute
          miles, km is kilometres, and ft is feet. BKN means broken cloud, OVC overcast, and VV
          obscured vertical visibility. VIS -- means no numeric visibility is displayable, not
          zero. Below 5 km the source miles and converted kilometres are shown in detail;
          5–10 km shows kilometres only, and above 10 km shows &gt;10 km. Source lower bounds
          remain lower bounds: “&gt;” means greater than, “≥” at least, and “&lt;” less than.
        </p>
        <p>
          <strong>Colours:</strong> green means no structured weather code and gust below 30 kt;
          red highlights any reported weather code or gust at least 30 kt; grey means no usable
          overlapping TAF data. Colours are dashboard cues, not official severity ratings.
        </p>
        <p>Scroll inside the table vertically for more airports and horizontally for later hours.</p>
      </div>
      {timelines.length === 0 ? (
        <p className="empty taf-empty">No route airports in this window.</p>
      ) : (
        <div
          className="taf-scroll"
          role="region"
          aria-label="Hourly route airport TAF table; scroll for more airports and later hours"
          tabIndex={0}
        >
          <table className="taf-table">
            <thead>
              <tr>
                <th className="taf-airport-heading">Airport</th>
                {data.hours.map((hour) => (
                  <th key={hour.label}>
                    <span>{hour.label}</span>
                    <small>{formatClock(hour.startsAt)} HKT</small>
                    <small>{formatUtcClock(hour.startsAt)}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timelines.map((timeline) => (
                <Fragment key={timeline.airportIata}>
                  <tr>
                    <th className="taf-airport">
                      <strong>{airportDisplayName(timeline)}</strong>
                      <small>
                        {airportMeta(timeline)} · {timeline.flightCount} flights ·{" "}
                        {directionCountText(timeline)}
                      </small>
                      <small>
                        TAF issued {timeline.issuedAt ? formatUtcClock(timeline.issuedAt) : "NO DATA"}
                      </small>
                    </th>
                    {timeline.cells.map((cell) => (
                      <td
                        className={tafTimelineCellClass(cell)}
                        key={`${timeline.airportIata}-${cell.hourOffset}`}
                        title={tafTimelineCellTitle(cell)}
                      >
                        {cell.summary}
                      </td>
                    ))}
                  </tr>
                  <tr className="taf-raw-row">
                    <th className="taf-airport taf-raw-label">Raw TAF</th>
                    <td colSpan={data.hours.length}>
                      <details>
                        <summary>Show raw TAF for {timeline.airportIata}</summary>
                        <code>{timeline.rawTaf ?? "No raw TAF returned."}</code>
                      </details>
                      <small className="action-help">
                        Click the line above to expand or collapse the exact encoded source report.
                      </small>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="taf-note">
        TAF is a forecast, not a live observation or operational warning. For the official code
        guide, open the{" "}
        <a href={TAF_DECODE_URL} target="_blank" rel="noreferrer">
          Hong Kong Observatory TAF decoding page
        </a>
        {" "}(new tab).
      </p>
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
  const [displayFilters, setDisplayFilters] = useState<{
    direction: DirectionFilter;
    traffic: TrafficFilter;
    horizon: HorizonFilter;
  }>({ direction: "both", traffic: "both", horizon: 12 });
  const requestSequence = useRef(0);

  async function loadDashboard(force = false) {
    const requestId = ++requestSequence.current;
    const requestedFilters = { direction, traffic, horizon };
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
        setDisplayFilters(requestedFilters);
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
          <p className="acknowledgement">Dashboard being developed by Dylan.</p>
          <p className="hero-help">
            HKIA is Hong Kong International Airport. HKG is its common three-letter airport code;
            VHHH is its four-letter aviation location code (ICAO) used in aviation weather.
            This page combines airport schedules, aviation weather, and optional origin-airport
            disruption data.
          </p>
        </div>
        <div className="status-card">
          <div>
            <span>
              Generated
              <small>Snapshot reference time, set before source data is fetched.</small>
            </span>
            <strong>{formatDateTime(data?.generatedAt)}</strong>
          </div>
          <div>
            <span>
              HKIA source
              <small>Latest update time reported by the airport feed.</small>
            </span>
            <strong>{formatDateTime(data?.sourceUpdatedAt)}</strong>
          </div>
          <div>
            <span>
              Next cache expiry
              <small>After this time, a normal request may fetch fresh source data.</small>
            </span>
            <strong>{formatDateTime(data?.cacheExpiresAt)}</strong>
          </div>
          <button type="button" onClick={() => void loadDashboard(true)} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Manual refresh"}
          </button>
          <small className="action-help refresh-help">
            Click to bypass the current server cache and request the source data again now.
          </small>
        </div>
      </section>

      {error ? (
        <div className="notice error-notice" role="alert">
          <strong>Dashboard update failed</strong>
          <span>{error}</span>
          <small>
            {data
              ? "The previous results remain visible. Use Manual refresh to try again."
              : "No dashboard result is available yet. Use Manual refresh to try again."}
          </small>
        </div>
      ) : null}
      {loading && data ? (
        <div className="notice loading-notice" role="status">
          <strong>Updating filtered data...</strong>
          <small>
            The previous values remain visible until the new request finishes. Displayed result:
            {` ${directionWindowFlightLabel(displayFilters.direction, displayFilters.horizon)} · ${
              displayFilters.traffic === "both"
                ? "Passenger + cargo"
                : displayFilters.traffic === "passenger"
                  ? "Passenger"
                  : "Cargo"
            }.`}
          </small>
        </div>
      ) : null}
      {data?.warnings.length ? (
        <div className="notice warning-notice" role="status">
          <strong>Data quality notices</strong>
          <small>
            These notices identify missing source reports or failed requests; they are not
            operational alerts.
          </small>
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
          <CollapsiblePanel title={`${directionChartTitle(displayFilters.direction)} · HKT / UTC (Z)`}>
            <ArrivalRateChart data={data} direction={displayFilters.direction} />
          </CollapsiblePanel>
          <SummaryStrip
            data={data}
            direction={displayFilters.direction}
            horizon={displayFilters.horizon}
          />
          <CollapsiblePanel title="Arrival Origin Operational Insights">
            <ArrivalOriginOperationalInsights data={data} horizon={displayFilters.horizon} />
          </CollapsiblePanel>
          <CollapsiblePanel title="Hourly Route Airport Ranking">
            <HourlyRouteAirportRanking data={data} horizon={displayFilters.horizon} />
          </CollapsiblePanel>
          <CollapsiblePanel title={`Top 10 ${routeAirportScope(displayFilters.direction)} by region · ${windowLabel(displayFilters.horizon)}`}>
            <TopAirportsPanel
              data={data}
              direction={displayFilters.direction}
              horizon={displayFilters.horizon}
            />
          </CollapsiblePanel>
          <CollapsiblePanel title="Hourly Route Airport TAF">
            <RouteAirportTafPanel data={data} horizon={displayFilters.horizon} />
          </CollapsiblePanel>
          <CollapsiblePanel title="Flight Situational Awareness real-time Dashboard">
            <FlightSituationTable data={data} />
          </CollapsiblePanel>
        </>
      ) : null}
    </main>
  );
}
