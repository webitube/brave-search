## Plan: Add Request Queue to Brave Web Search + Refactor + Unit Tests

**TL;DR:** Replace the reactive `checkRateLimit()` guard in `brave_web_search` with an async request queue that serializes API calls with a configurable delay between them. While doing so, refactor the monolithic index.ts into a clean module structure (`src/tools/`, `src/queue/`, `src/types/`, `src/config/`) and introduce **Vitest** as the unit test framework with tests for the queue and tool logic.

---

### Phase 1 — Project scaffolding: test framework & directory structure

**Goal:** Establish the foundation (test runner, folder layout) before any code changes.

1. **Add Vitest and test utilities to `devDependencies`** in package.json
   - Add `vitest` and `@vitest/coverage-v8` to devDependencies
   - Add `"test": "vitest"` and `"test:run": "vitest run"` scripts

2. **Create `vitest.config.ts`** at project root
   - Configure ESM mode, `test.environment: 'node'`, globals off
   - Set `include` to `["test/**/*.test.ts"]`

3. **Create directory structure**
   - `src/tools/` — tool definitions and handler logic
   - `src/queue/` — request queue implementation
   - `src/types/` — shared TypeScript interfaces
   - `src/config/` — environment config and constants
   - `test/` — unit tests

4. **Update tsconfig.json**
   - Change `rootDir` from `"."` to `"./src"`
   - Add `"declaration": true`

---

### Phase 2 — Refactor: extract types, config, and tools into modules

**Goal:** Break index.ts into focused, importable modules. No behavioral changes yet.

1. **Create `src/types/brave.ts`**
   - Move all interfaces (`BraveWeb`, `BraveLocation`, `BravePoiResponse`, `BraveDescription`) here

2. **Create `src/config/env.ts`**
   - Extract `BRAVE_API_KEY` loading/validation and `RATE_LIMIT` constants
   - Export a `getConfig()` function returning validated config

3. **Create `src/tools/web-search.ts`**
   - Move `WEB_SEARCH_TOOL`, `isBraveWebSearchArgs()`, and `performWebSearch()` here
   - Import types from `src/types/brave.ts`, config from `src/config/env.ts`

4. **Create `src/tools/local-search.ts`**
   - Move `LOCAL_SEARCH_TOOL`, `isBraveLocalSearchArgs()`, `performLocalSearch()`, `getPoisData()`, `getDescriptionsData()`, `formatLocalResults()` here

5. **Rewrite index.ts as a thin entry point**
   - Import tool definitions and handlers from `src/tools/`
   - Keep SSE/Express server setup and `app.listen()` here
   - Verify build succeeds (`npm run build`)

---

### Phase 3 — Implement the request queue

**Goal:** Add a serializing queue with configurable delay that wraps `brave_web_search` (and all other) API calls.

1. **Create `src/queue/request-queue.ts`**
   - `RequestQueue` class with:
     - Constructor accepts `delayMs: number` (default 1000ms)
     - `enqueue<T>(task: () => Promise<T>): Promise<T>` — appends task, returns Promise
     - Tasks execute one-at-a-time, sequentially, FIFO order
     - After each task completes (resolve or reject), wait `delayMs` before the next
     - Delay fires *between* tasks, not before the first

2. **Add `QUEUE_DELAY_MS` to `src/config/env.ts`**
   - Read from `process.env.QUEUE_DELAY_MS`, default `1000` (milliseconds)
   - Validate as positive number

3. **Integrate queue into `src/tools/web-search.ts`**
   - Create a singleton `RequestQueue` instance
   - Wrap the `fetch()` call in `performWebSearch()` with `queue.enqueue(...)`
   - **Remove `checkRateLimit()`** — the queue is strictly better (no burst, guaranteed spacing)

4. **Integrate queue into `src/tools/local-search.ts`**
   - Apply same queue wrapping to `performLocalSearch()`, `getPoisData()`, `getDescriptionsData()`
   - Ensures ALL Brave API calls go through the queue

---

### Phase 4 — Unit tests

**Goal:** Verify queue behavior, tool argument validation, and refactored module imports.

1. **`test/queue/request-queue.test.ts`**
   - Single task executes and returns result
   - Multiple tasks execute in FIFO order (verify with shared counter)
   - Delay is enforced between tasks (use `vi.useFakeTimers()`)
   - Rejected task does not break the queue — subsequent tasks still execute
   - Concurrent `enqueue()` calls are all processed (no dropped tasks)

2. **`test/tools/web-search.test.ts`**
   - `isBraveWebSearchArgs()` returns `true`/`false` correctly
   - `performWebSearch()` resolves with formatted results (mock `fetch` via `vi.stubGlobal`)
   - API error response throws appropriate error

3. **`test/tools/local-search.test.ts`**
   - `isBraveLocalSearchArgs()` type guard behavior
   - `formatLocalResults()` formatting with sample data
   - Fallback to web search when no location IDs returned

4. **`test/config/env.test.ts`**
   - Missing `BRAVE_API_KEY` throws error
   - Valid config returns expected values
   - `QUEUE_DELAY_MS` defaults to 1000 when unset

---

### Phase 5 — Verification & cleanup

1. Run `npm run build` — zero TypeScript errors
2. Run `npm test` — all tests pass
3. Manual smoke test: start server, verify SSE endpoint works
4. Verify Dockerfile still works with new `src/` structure
5. Update README.md to document `QUEUE_DELAY_MS`

---

### Files to create
| File | Purpose |
|---|---|
| `src/types/brave.ts` | Shared TypeScript interfaces |
| `src/config/env.ts` | Environment config and constants |
| `src/tools/web-search.ts` | Web search tool definition + handler |
| `src/tools/local-search.ts` | Local search tool definition + handler |
| `src/queue/request-queue.ts` | Serializing request queue class |
| `vitest.config.ts` | Vitest configuration |
| `test/queue/request-queue.test.ts` | Queue unit tests |
| `test/tools/web-search.test.ts` | Web search unit tests |
| `test/tools/local-search.test.ts` | Local search unit tests |
| `test/config/env.test.ts` | Config unit tests |

### Files to modify
| File | Change |
|---|---|
| index.ts | Rewrite as thin entry point importing from `src/` |
| package.json | Add Vitest devDependencies and test scripts |
| tsconfig.json | Update `rootDir` to `./src` |
| README.md | Document `QUEUE_DELAY_MS` |

### Key decisions
- **Vitest** over Jest — ESM-native, zero-config for TypeScript, excellent `vi.useFakeTimers()` for queue delay testing
- **Queue replaces `checkRateLimit()`** — serializes with guaranteed spacing vs. the current counter which allows bursts
- **All API calls go through the queue** — not just web search, for consistency
- **`src/` directory structure** — standardizes the project and keeps test files out of `dist/`
