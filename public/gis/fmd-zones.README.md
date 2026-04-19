# FMD Zones (`fmd-zones.geojson`)

## What this is

A static GeoJSON FeatureCollection of Foot-and-Mouth Disease (FMD) zones used by
the FarmMap's "FMD red-line" overlay layer. Served through the tenant-less
proxy route `/api/map/gis/fmd-zones`.

## Current state (Wave 2C placeholder)

The current file contains a single, **coarse** MultiPolygon tracing the Kruger /
Lowveld FMD protection zone (the "red line"). It is **not** legally binding and
should be treated as visual-only until a real DALRRD source is wired in
(targeted for Wave 4).

Each feature includes these properties:

| Property       | Meaning                                                    |
|----------------|------------------------------------------------------------|
| `zoneId`       | Stable identifier (e.g. `fmd-red-line-kruger-buffer`)      |
| `zoneType`     | `red-line` \| `protection-with-vaccination` \| `surveillance` |
| `name`         | Human-readable zone name                                   |
| `province`     | Affected province(s), ISO-2 joined with `/` (e.g. `MP/LP`) |
| `authority`    | Issuing authority (DALRRD)                                 |
| `effectiveFrom`| ISO date when the zone was declared                        |
| `notes`        | Free-text context                                          |

## Source of truth

When updating, pull from one of:

1. **DALRRD Veterinary Services** — quarterly bulletins, typically shapefile/PDF.
   Convert shapefile → GeoJSON with `ogr2ogr -f GeoJSON out.geojson in.shp`.
2. **OIE/WOAH SAM** — World Organisation for Animal Health, South Africa entry.
3. **RMIS** (Red Meat Industry Services) — integrated trace portal, live from
   April 2026.

## Refresh cadence

- **Quarterly** at minimum (Jan/Apr/Jul/Oct).
- **Immediately** on any DALRRD zone redeclaration (outbreak events).

## PR process for updates

1. Obtain the new shapefile from the authority above.
2. Convert to GeoJSON + simplify to < 500KB (use `mapshaper -simplify 5%`).
3. Replace this file. Keep properties schema stable — the UI depends on
   `zoneType`, `name`, and `effectiveFrom`.
4. Bump `_lastRefreshed` at the FeatureCollection level.
5. Update this README's "Current state" section with the new source.
6. Open a PR titled `chore(gis): refresh FMD zones YYYY-MM-DD`.

## Why static (not a live fetch)

DALRRD does not publish a machine-readable, stable-URL FMD zone endpoint.
Scraping the PDF bulletin on every request is fragile. Shipping the zone file
committed to the repo is safer:

- Zero runtime dependency on DALRRD infrastructure.
- Zero external quota cost.
- Reviewable via git diff when zones change.
- UI never 500s from a failing upstream.
