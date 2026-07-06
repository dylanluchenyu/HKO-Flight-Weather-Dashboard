# HKO Flight Weather Dashboard

Flight situational awareness dashboard for HKIA arrivals, departures, and
airport weather impact.

## What It Shows

- Wallace-style hourly situational-awareness table from `T(now)` to the selected
  `6/12/15/18/24/30h` horizon.
- Direction filter for inbound, outbound, or both directions. Combined mode
  includes arrivals and departures in the chart, table, summaries, airport watch
  list, and operational concern cards.
- Predicted HKIA-linked flight counts by region and estimated status:
  `en route`, `on ground`, and `within 100km of HK`.
- Separate `TAF` forecast row plus a bad-weather/deep-convection row based on
  public aviation METAR/TAF data.
- Next `6/12/18/24/30h` summaries for arrival origins, departure destinations,
  and bad-weather matches.
- Local Hong Kong time and UTC `Z` time on hourly chart and table headers.

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
npm run build
```

## Notes

- The dashboard auto-refreshes every 30 minutes and supports manual refresh.
- Flights are placed into the Wallace table when their scheduled HKIA time falls
  inside the selected hourly bucket and matches the selected direction and flight
  type.
- A priority airport means HKG plus route airports ranked by current flight
  count. The busiest mapped airports are queried first for METAR/TAF so the live
  dashboard remains responsive.
- `en route` and `within 100km` are estimates from schedule, distance, and an
  820 km/h cruise-speed assumption because HKIA public data does not include
  live aircraft positions. `Within 100km` only counts flights already estimated
  airborne near Hong Kong.
- For arrivals, `on ground` means still at the origin airport. For departures,
  `on ground` means still at HKIA before scheduled departure.
- `Significant` weather includes wind/gust at least 35 kt, visibility below
  0.62 SM, ceiling below 1000 ft, or listed aviation hazard weather codes.
  `Severe` includes TS, FZ, SQ, FC, VA, SS, and DS.
- Greater China includes mainland China, Hong Kong, Macau, and Taiwan.
