# Performance Optimization Log - 2026-06-09

Branch: `cartoon-feedback`

Purpose: record the network-transfer optimizations implemented for the WhereToI Week 3 performance slice, with commit evidence, measurable size changes, and estimated engineering time share for later reporting.

## Commit Evidence

| Commit | Optimization | Main result |
| --- | --- | --- |
| `217d62b` | Stop startup CSV transfer | Startup no longer fetches `src/data/toilets.csv`; `dist/src/data/toilets.csv` is excluded from static builds. |
| `f591be1` | Enable browser cache headers | Static files now use browser caching and `Last-Modified` validation; public toilet API responses use short cache headers; sensitive account/auth responses stay `no-store`. |
| `8af08bb` | Compress text responses | Server supports gzip/Brotli for JSON and text static assets over 1KB. |
| `a17edb1` | Optimize visual feedback images | Visual cleanliness images now use small JPEG derivatives and Pages builds copy only `_small.jpg` files. |
| `42e9cdb` | Cache toilet detail requests | Toilet detail responses are cached in memory for 5 minutes, with force refresh support. |

## Transfer Impact

| Area | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Startup CSV fallback | 7,767,720 bytes requested on startup | 0 bytes requested on startup | 100% removed from startup transfer |
| Published CSV artifact | 7,767,720 bytes in `dist/src/data/toilets.csv` | excluded from `dist` | 100% removed from static artifact |
| Visual cleanliness image set | 5,925,042 bytes | 171,005 bytes | 97.1% smaller |

## Compression Samples

Measured locally with Node `zlib` after the compression commit.

| File | Raw | Gzip | Brotli | Gzip reduction | Brotli reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| `src/styles.css` | 48,953 | 8,072 | 6,891 | 83.5% | 85.9% |
| `src/app/controllers/map-controller.js` | 58,037 | 12,959 | 11,200 | 77.7% | 80.7% |
| `src/app/services/toilets-service.js` | 5,920 | 1,617 | 1,432 | 72.7% | 75.8% |
| `server/app-server.mjs` | 23,350 | 5,441 | 4,718 | 76.7% | 79.8% |

## Cache Behavior

| Layer | Behavior |
| --- | --- |
| Static HTML | `Cache-Control: no-cache`, with `Last-Modified` validation. |
| Static CSS/JS/text assets | `public, max-age=3600, stale-while-revalidate=86400`, with `Last-Modified` validation and gzip/Brotli when supported. |
| Static images | `public, max-age=604800, immutable`. |
| Public toilet list/detail API | `public, max-age=60, stale-while-revalidate=120`. |
| Client toilet list cache | 2-minute in-memory cache keyed by cleanliness range and map bounds. |
| Client toilet detail cache | 5-minute in-memory cache per toilet id. |
| Client feedback comments cache | 60-second in-memory cache per toilet id, invalidated by auth state changes and updates. |
| Sensitive APIs | Login, registration, account, access history, ratings, comment writes/deletes/likes stay `Cache-Control: no-store`. |

## Estimated Engineering Time Share

These percentages record relative implementation and verification time in this session, rounded for presentation use.

| Workstream | Time share |
| --- | ---: |
| Remove startup CSV transfer and static CSV artifact | 20% |
| Browser cache headers and 304 validation | 22% |
| gzip/Brotli compression | 20% |
| Visual feedback image optimization and build artifact fix | 24% |
| Toilet detail client cache | 9% |
| Measurement, reporting notes, and final verification | 5% |

## Verification Run During Implementation

- `npm.cmd run check`
- `npm.cmd test -- test/app-initialize.test.mjs test/toilets-service.test.mjs`
- `npm.cmd test -- test/app-server.test.mjs`
- `npm.cmd test -- test/map-controller.test.mjs`
- `npm.cmd test -- test/toilets-service.test.mjs`
- `npm.cmd run build`

Final full-suite verification should still be run before push or merge.
