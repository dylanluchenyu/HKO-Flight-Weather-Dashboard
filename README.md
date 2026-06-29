# HKO Flight Weather Dashboard

First-draft flight situational awareness dashboard for Hong Kong arrivals and
airport weather impact.

## What It Shows

- Wallace-style hourly arrival table from `T(now)` to `+15`.
- Predicted HK arrival counts by region and estimated status:
  `en route`, `on land`, and `within 100km`.
- Bad-weather/deep-convection status based on public aviation METAR/TAF data.
- Next `6/12/18/24h` summaries for arrival origins, departure destinations, and
  bad-weather matches.
- GIS-style trajectory map with estimated great-circle routes.

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
- `en route`, `on land`, and `within 100km` are estimated from schedule,
  distance, and typical cruise speed because HKIA public data does not include
  live aircraft positions.
- The current GIS view uses great-circle trajectories, not live ADS-B tracks.
