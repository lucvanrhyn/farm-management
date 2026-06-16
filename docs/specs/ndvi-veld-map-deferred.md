# NDVI Veld-Map — DEFERRED (not a quick win)

**Status:** deferred 2026-06-14 (grilling session). Decision: skip for now.

## Why deferred
Unlike quick wins #1–4, this one fails the session's quick-win criteria
(reuse existing infra / fast / no recurring cost):
- **No satellite pipeline exists** — genuinely net-new integration.
- **Needs camp polygons** (`Camp.geojson`), which are operator-drawn and
  often missing (#396) — a hard data dependency.
- Real NDVI sources carry a recurring API cost or heavy build.

## Two future paths (when picked up)
1. **Reuse-only "veld signal" (true quick win, ~1wk, no cost)** — a per-camp
   veld/drought choropleth on the existing FarmMap polygons, computed from data
   already produced: `veld-score.ts` + `spi.ts` (SPI drought) + rotation
   rest-days + Open-Meteo drought. Not satellite NDVI, but a real veld map with
   zero new integration. **Recommended first step if revived.**
2. **Real Sentinel-2 NDVI (~2–4wk + recurring cost)** — Sentinel Hub
   Statistical API for per-polygon mean NDVI + time-series (minimal build, ~€/mo),
   rendered as choropleth on FarmMap polygons with farm-bbox fallback + a
   "draw your camps to unlock per-camp NDVI" prompt. The free Copernicus/Earth
   Engine route avoids the fee but needs raster processing + auth infra.

## Prereq either way
A camp-boundary drawing flow so `Camp.geojson` is populated (ties to #396).
