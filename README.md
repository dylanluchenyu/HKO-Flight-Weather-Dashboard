# HKO Flight Weather Dashboard

Flight situational awareness dashboard for HKIA arrivals, departures, and
source-reported airport weather context.

## What It Shows

- Wallace-style hourly situational-awareness table from `T(now)` to the selected
  `6/12/15/18/24/30h` horizon.
- Direction filter for inbound, outbound, or both directions. Combined mode
  includes arrivals and departures in the chart, table, summaries, airport watch
  list, and operational concern cards.
- Predicted HKIA-linked flight counts by region and estimated status:
  `en route`, `on ground`, `within 100km of HK`, and explicit `unknown`.
- Separate `TAF` forecast row plus a reported-weather row based on structured
  public aviation METAR/TAF data. Neither row invents a severity rating.
- Next `6/12/18/24/30h` summaries for arrival origins, departure destinations,
  and reported-weather matches.
- Local Hong Kong time and UTC `Z` time on hourly chart and table headers.
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
- The Wallace rate row counts scheduled HKIA movements in one-hour buckets.
  Region/status rows are point-in-time snapshots: every T/+N column reevaluates
  all selected active flights at that forecast time.
- A priority airport means HKG plus mapped route airports ranked by selected-window
  flight count. The first 72 are queried for METAR and the first 45 for TAF so the
  live dashboard remains responsive.
- Estimated flight duration is
  `max(1 hour, great-circle distance / 820 km/h + 0.55 hour)`. `En route` and
  `within 100km` are schedule-and-distance estimates because HKIA public data does
  not include live aircraft positions. `Within 100km` includes every flight that
  is estimated airborne and at most 100 km from Hong Kong at that forecast time.
- For arrivals, `on ground` means still at the origin airport. For departures,
  `on ground` means still at HKIA before scheduled departure.
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
  periods that overlap the relevant hour. `TEMPO`, `BECMG`, `FM`, and `PROBnn`
  are preserved from the source. Raw report text is retained for reference but
  is never scanned for hazard substrings.
- Wind, gust, visibility, and cloud values are not converted into a custom impact
  category. Operational minima depend on information not present in this dataset,
  including runway, aircraft, operator, and official warning criteria.
- Operational-concern cards contain active or next-30-hour selected flights whose
  route-airport report contains `REPORTED WX` in the applicable period. Cards are
  sorted by scheduled time and do not imply severity.
- Missing airport, distance, METAR, or TAF data is shown as `Unknown` or `NO DATA`
  and appears in the data-quality notices; absence is never interpreted as no
  reported weather.
- Greater China includes mainland China, Hong Kong, Macau, and Taiwan.

## Official Weather References

- [HKO: Decoding Aviation Weather Report (METAR/SPECI)](https://www.hko.gov.hk/en/aviat/decode_metar.htm)
- [HKO: Decoding Aerodrome Forecast (TAF)](https://www.hko.gov.hk/en/aviat/decode_taf.htm)
- [AviationWeather Data API and OpenAPI specification](https://aviationweather.gov/data/api/)

The AviationWeather documentation describes METAR as terminal observations, TAF
as terminal forecasts, and SIGMET as a separate aviation-warning product. This
dashboard does not relabel a METAR/TAF weather group as a SIGMET or warning.
