# WHO Hantavirus Outbreak Tracker 🗺

An interactive world map tracking the latest WHO-reported hantavirus outbreak. Fetches and parses live WHO outbreak articles, classifying countries by their role and placing zoomable case/death markers on the map.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in browser
open http://localhost:3000
```

---

## GitHub Pages

This repo can publish a static snapshot to GitHub Pages even though local development uses Express.

Share URL:
`https://k-markov01.github.io/hantavirus-tracker/`

How it works:
- `.github/workflows/deploy-pages.yml` builds a static `dist/` artifact on every push to `main`
- `scripts/build-pages.js` fetches the latest WHO data at build time and writes `dist/api/outbreak.json`
- the frontend first tries the live API, then falls back to the static snapshot automatically on Pages

If GitHub Pages is not already enabled in the repository settings:
- Go to `Settings > Pages`
- Set `Source` to `GitHub Actions`

---

## Features

| Feature | Description |
|---|---|
| 🔴 **Case Countries** | Nations with WHO-confirmed hantavirus cases — shown in red |
| 🟠 **Exposure Countries** | Known exposure or transmission sources — shown in orange |
| 🟡 **Monitoring Countries** | Under surveillance / active monitoring — shown in yellow |
| ⬜ **Mentioned Countries** | Referenced in WHO response — shown in gray |
| 💀 **Death Markers** | Specific fatality locations from the WHO report |
| 🔴 **Case Markers** | Active/confirmed case locations from the WHO report |
| 🔄 **Live Refresh** | Force-fetch fresh WHO data anytime with one click |
| 🔎 **Zoomable Map** | Scroll/pinch to zoom, click countries to focus |

---

## Architecture

```
hantavirus-tracker/
├── server/
│   ├── index.js       ← Express server, caching, API routes
│   └── parser.js      ← WHO HTML fetcher + Cheerio parser + country classifier
├── public/
│   └── index.html     ← D3.js + TopoJSON frontend map app
├── package.json
└── README.md
```

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/outbreak` | Returns cached outbreak data (auto-refreshes if stale >30min) |
| `POST` | `/api/outbreak/refresh` | Forces a fresh WHO fetch and re-parse |
| `GET` | `/assets/world/countries-110m.json` | Serves world topology from `world-atlas` |

### Data Sources

| Source | URL | Purpose |
|---|---|---|
| WHO Emergencies | `https://www.who.int/emergencies/emergency-events/1` | Discover latest hantavirus event |
| WHO DON Articles | `https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON600` | Primary outbreak data |
| WHO Fact Sheet | `https://www.who.int/news-room/fact-sheets/detail/hantavirus` | Reference link in UI |

---

## Dependencies

- **[Express](https://expressjs.com/)** — HTTP server and API routes
- **[Cheerio](https://cheerio.js.org/)** — Server-side HTML parsing of WHO pages
- **[node-fetch v2](https://www.npmjs.com/package/node-fetch)** — HTTP client for WHO requests
- **[world-countries](https://www.npmjs.com/package/world-countries)** — Country name → ISO3 matching
- **[world-atlas](https://www.npmjs.com/package/world-atlas)** — TopoJSON country boundaries
- **[D3.js v7](https://d3js.org/)** *(CDN)* — Map rendering, zoom, markers, labels
- **[TopoJSON Client](https://github.com/topojson/topojson-client)** *(CDN)* — Topology → GeoJSON

---

## How Parsing Works

1. **Discovery**: The server fetches `who.int/emergencies/emergency-events/1` and scans for links mentioning "hantavirus". Falls back to the latest known DON article URL.

2. **Article Parse**: Cheerio extracts the article body text. A multi-strategy country extractor scans for all country name variants (common, official, native, aliases) using longest-match first.

3. **Role Classification**: Each country found is classified by analyzing the sentences it appears in:
   - **Cases** → sentences with: *confirmed case, patient, hospitalized, death, infection...*
   - **Exposure** → sentences with: *exposure, travel, contact, reservoir, rodent...*
   - **Monitoring** → sentences with: *monitor, surveillance, screening, alert...*
   - **Mentioned** → any other reference

4. **Markers**: A location database of ~50 cities/regions (lat/lon) is matched against sentences that contain death/case keywords, producing skull or dot markers.

5. **Caching**: Results are cached in memory for 30 minutes. Use `POST /api/outbreak/refresh` to force a fresh fetch.

---

## Environment

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port to listen on |

---

## Notes

- WHO HTML structure can change — if parsing returns 0 countries, check the server logs and inspect the raw article HTML.
- The fallback dataset (Chile/Argentina) activates if WHO fetching fails entirely.
- The app uses D3's Natural Earth projection. Zoom is mouse-wheel or touchpad pinch.
