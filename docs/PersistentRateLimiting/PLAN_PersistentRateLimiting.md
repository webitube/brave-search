# Plan: Persistent Rate Limit Storage

**Status:** ✅ **Completed**

## Overview

Replace the in-memory rate limiter with a file-backed persistent store so that request counters survive server restarts. The store tracks per-second and per-month counts along with timestamp metadata.

---

## Concerns & Mitigations

| Concern | Mitigation |
|---|---|
| **File I/O on every request** | Buffer writes in memory and flush to disk on a periodic timer (e.g., every 5 seconds) and on graceful shutdown. The per-second counter remains in-memory only (no persistence needed across restarts). |
| **Race conditions** | Single-process server — no concurrent writes. For future multi-instance support, the JSON file can be replaced with a Redis-backed store without changing the API surface. |
| **Atomicity / corruption** | Use write-then-rename: write to a `.tmp` file first, then atomically rename to the final path. On startup, validate the JSON before loading; fall back to fresh counters on parse errors. |

---

## Phases

### Phase 1: Persistent Store Module

**Goal:** Create a reusable rate-limit store that reads/writes a local JSON file.

- [x] Create `src/rate-limit-store.ts`
- [x] Define state shape:
  ```json
  {
    "monthCount": 0,
    "monthStart": "2026-07-01T00:00:00.000Z",
    "lastRequestTimestamp": 1719999999000,
    "lastFlush": 1719999999999
  }
  ```
- [x] Implement `loadState()` — reads from `.rate-limit-state.json`; resets monthly counter if a new calendar month has started; returns fresh state on missing/corrupt file
- [x] Implement `increment()` — increments in-memory counter and updates `lastRequestTimestamp`
- [x] Define global constant `DEFAULT_REQUEST_DELAY_MS` (default: `1000ms`) — minimum delay between requests
- [x] Support `RATE_LIMIT_REQUEST_DELAY_MS` env var to override `DEFAULT_REQUEST_DELAY_MS`
- [x] Implement `getTimeSinceLastRequest()` — returns milliseconds elapsed since the last request
- [x] Implement `getTimeUntilNextRequest()` — returns milliseconds remaining until the next request can be made (based on `RATE_LIMIT_REQUEST_DELAY_MS`); returns `0` if enough time has passed
- [x] Implement `flush()` — writes to `.rate-limit-state.json.tmp` then renames to `.rate-limit-state.json`
- [x] Implement `startFlushTimer(intervalMs)` — sets up `setInterval` for periodic flush
- [x] Implement `stopFlushTimer()` — cleans up interval on shutdown
- [x] Add `.rate-limit-state.json` and `.rate-limit-state.json.tmp` to `.gitignore`

### Phase 2: Integrate with `checkRateLimit()`

**Goal:** Wire the persistent store into the existing rate-limiting logic.

- [x] Replace `requestCount.month` with `store.increment()` + `store.getMonthCount()`
- [x] Keep per-second delay in-memory (no persistence needed — it resets every 1000ms regardless)
- [x] Update error message to include remaining quota (e.g., "998/1000 requests remaining this month")
- [x] Register graceful shutdown handler (`process.on('SIGTERM')`, `process.on('SIGINT')`) that calls `store.flush()` before exit

### Phase 3: Configuration & Testing

**Goal:** Make the store configurable and verify correctness.

- [x] Add `RATE_LIMIT_STATE_FILE` env var to customize the state file path (default: `.rate-limit-state.json`)
- [x] Add `RATE_LIMIT_FLUSH_INTERVAL_MS` env var to customize flush interval (default: 5000ms)
- [x] Add `RATE_LIMIT_PER_MONTH` env var to override the monthly limit (default: 1000)
- [x] Add `RATE_LIMIT_REQUEST_DELAY_MS` env var to override the minimum delay between requests (default: `1000ms`)
- [x] Unit tests: `tests/rate-limit-store.test.ts` covers `increment()`, `flush()`, `loadState()`, `getRemainingQuota()`, timer management, state persistence, corrupt file handling, and monthly reset
- [x] Manual test: start server, make requests, kill process, restart — verify counter persists
- [x] Manual test: corrupt the state file — verify graceful fallback to fresh counters
- [x] Manual test: verify monthly reset works when `monthStart` is in a previous month
- [x] Manual test: verify `getTimeSinceLastRequest()` returns correct elapsed time
- [x] Manual test: verify `getTimeUntilNextRequest()` returns `0` after delay has passed, and positive ms before delay expires
- [x] Manual test: verify `RATE_LIMIT_REQUEST_DELAY_MS` env var overrides the default delay

---

## File Structure (After Implementation)

```
brave-search/
├── src/
│   └── rate-limit-store.ts       # Persistent rate-limit store
├── tests/
│   └── rate-limit-store.test.ts  # Unit tests for rate-limit store
├── index.ts                      # Updated: uses rate-limit-store
├── .rate-limit-state.json        # Generated at runtime (gitignored)
└── .gitignore                    # Updated: excludes state files
```

---

## Risks & Trade-offs

- **Counters may drift** — If the process crashes before a flush, the last ~5 seconds of requests are lost. This is acceptable because it's a client-side safeguard, not a hard enforcement boundary.
- **Disk space** — Negligible; the state file is ~100 bytes.
- **No distributed support** — This is single-instance only. Multi-instance deployments would need Redis or a similar shared store (noted as future work).
