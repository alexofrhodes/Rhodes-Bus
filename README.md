# Standalone Bus

Rhodes bus **Schedule** + **Map** viewer. Static site + installable PWA.

Live site: [alexofrhodes.github.io/Rhodes-Bus](https://alexofrhodes.github.io/Rhodes-Bus/)

This folder is its **own git repo**. The parent directory is the **Bus Check** Python app.

## Run locally

```bash
python -m http.server 8081
```

Or `_serve.bat`. Open http://127.0.0.1:8081/

## Publish schedule updates

**From Bus Check GUI (recommended):**

1. Check + **Extract** (Combined + JSON) in the parent app
2. **WEBSITE** card shows `Docs: N file(s) to push` when ready
3. Click **Push docs** (or run `_push.bat`)

**CLI:**

```bash
# from parent (Bus Check) root — extract + sync data cache hash:
python scripts/extract_schedules.py

# sync SW hashes + commit + push docs repo:
python scripts/push_docs.py
```

Or from this folder: `_push.bat` (calls parent `scripts/push_docs.py`).

### PWA cache versions (automatic)

`scripts/sync_sw_version.py` writes content hashes into `service-worker.js`:

- **DATA** — hash of `src/data/bus_schedule.json` + `bus_stations.json` (runs after extract / stations export)
- **APP** — hash of site shell files (runs on full sync before push)

Same JSON → same hash (idempotent). Installed PWAs pick up new timetables after push + deploy.

Manual sync only if you edit site code without push:

```bash
python ../scripts/sync_sw_version.py
```

## GitHub Pages

Site files at the **root of this repo** (`index.html`, `src/`, …). Pages → deploy from branch `/`.

## Data files

| Path | Role |
|---|---|
| `src/data/bus_schedule.json` | Schedule runtime |
| `src/data/bus_stations.json` | Map pins runtime |

Stations source: parent `data/BUS_STATIONS.xlsx` → `python ../scripts/process_bus_stations.py`

Manual schedule path: edit `data/buses.xlsm` → export CSV → `python ../scripts/process_bus_schedule.py`

## Offline

Service worker caches the app shell; JSON uses stale-while-revalidate with hash-based cache buckets. Map tiles need network on first load.
