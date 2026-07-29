# HKO Flight Weather Dashboard

Flight situational awareness dashboard for HKIA arrivals, departures, and
source-reported airport weather context.

## What It Shows

- Fixed `T(now)` to `+15` Flight Situational Awareness table for arriving flights,
  matching the operational table layout: predicted arrival rate, deep convection
  status, HKG TAF significant weather, and regional in-air/on-land/within-100km
  arrival counts.
- Direction filter for inbound, outbound, or both directions. Combined mode
  includes arrivals and departures in the chart, summaries, airport watch list,
  and route-airport weather match panel. The situational-awareness table remains
  fixed to arrivals.
- Current-window summaries for all selected passenger/cargo flights, all route
  airports, and route airports matched to METAR/TAF weather.
- Deep convection status derived from VHHH METAR at `T(now)` and overlapping VHHH
  TAF periods for future columns. This is not an official alert feed or severity
  rating.
- The HKG TAF hourly row only shows significant forecast elements: thunderstorm
  or heavy weather codes, low visibility, low ceiling, or gusts of 30 kt or above.
- Top 10 route airports by region for the selected window. Inbound mode lists
  arrival origins, outbound mode lists departure destinations, and combined mode
  includes both.
- Route-airport weather matches aggregated by airport, including source, codes,
  observed time, forecast period, and selected-window flight count.
- Local Hong Kong time and UTC `(Z)` time on the hourly chart and on the
  situational-awareness table timeslot header.
- Route-airport groups for Greater China, Asia, the Middle East, Oceania,
  America, Africa, Europe, and unmapped/other locations.

## Data Sources

- HKIA public flight REST endpoint for passenger/cargo arrivals and departures.
- NOAA AviationWeather API for METAR/TAF weather reports.
- OurAirports public airport database as a fallback for IATA to ICAO/coordinate
  mapping.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

## Notes

- The dashboard auto-refreshes every 30 minutes and supports manual refresh.
- The situational-awareness table is fixed to arrival traffic and always shows
  the next 16 hourly slots, independent of the selected 6/12/18/24/30h window
  used by the other panels. The dashboard header shows actual HKT and UTC `(Z)`
  start times instead of `+1`, `+2`, etc.
- `Predicted flight arrival rate` is based on HKIA scheduled arrivals in each
  one-hour interval. It is a forecast from schedule data, not an actual landed
  count.
- `En route`, `on land`, and `within 100km` rows are schedule-and-distance
  estimates. `En route` means estimated in air but not within 100 km of Hong Kong;
  `within 100km` means estimated in air and close to Hong Kong.
- Weather lookup is a coverage/performance limit, not a business filter. The
  dashboard keeps all route airports in flight totals and rankings, while querying
  weather for top route airports by selected-window flight count. Airports outside
  that weather-query coverage are shown as `Not queried`, not as `NO DATA`.
- Route geometry and schedule-based flight phase fields remain available in the
  API for future GIS map work, but they are not part of the default cleaned
  dashboard display.
- METAR and TAF do not provide a universal `Severe`/`Significant` impact level.
  The dashboard therefore uses only three data states: `NO DATA` when no usable
  report exists, `NO REPORTED WX` when a structured report has no weather group
  (or explicitly says `NSW`), and `REPORTED WX` when `wxString` contains a
  reported or forecast weather code. These states are not operational ratings.
- HKO defines the displayed source codes: `-` means light, `+` means heavy,
  `VC` means vicinity, and examples include `TS` thunderstorms, `RA` rain,
  `DZ` drizzle, `BR` mist, `FG` fog, and `HZ` haze. Unknown codes remain visible
  verbatim instead of being assigned a dashboard-defined meaning.
- TAF weather is evaluated only from AviationWeather's structured forecast
  periods that overlap the relevant hour. Raw report text is retained for
  reference but is never scanned for hazard substrings.
- Wind gust can trigger the source-backed deep-convection indicator when it reaches
  the table threshold, but it is not converted into an operational severity.
  Operational minima depend on information not present in this dataset, including
  runway, aircraft, operator, and official warning criteria.
- The route-airport weather match panel aggregates by airport inside the selected
  window and does not imply severity.
- Missing airport, METAR, or TAF data is shown as `Unknown`, `NO DATA`, or
  `Not queried` as applicable; absence is never interpreted as no reported weather.
- Greater China includes mainland China, Hong Kong, Macau, and Taiwan.

## Official Weather References

- [HKO: Decoding Aviation Weather Report (METAR/SPECI)](https://www.hko.gov.hk/en/aviat/decode_metar.htm)
- [HKO: Decoding Aerodrome Forecast (TAF)](https://www.hko.gov.hk/en/aviat/decode_taf.htm)
- [AviationWeather Data API and OpenAPI specification](https://aviationweather.gov/data/api/)

The AviationWeather documentation describes METAR as terminal observations, TAF
as terminal forecasts, and SIGMET as a separate aviation-warning product. This
dashboard does not relabel a METAR/TAF weather group as a SIGMET or warning.
