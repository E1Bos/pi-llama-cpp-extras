# Prefill progress in a keyed UI slot

Tee the raw SSE of a llama.cpp request, parse `prompt_progress`, and render a live progress bar in a keyed UI slot while prefilling.

Status: open

Depends on ticket 01 (package shell).

## Reference implementation

The source of truth is **pi-llama-one** (`~/Code/pi-llama-one`), fully implemented and tested there, and the fork **`~/Code/pi-llama-cpp`** (commit `67f09e4`), which already ports it into pi-llama-cpp. Do not redesign the algorithm or the message format: reproduce the reference behavior exactly.

**Files to lift** (both self-contained, importing only `@earendil-works/pi-ai/compat`, `@earendil-works/pi-ai`, and node builtins):

- `src/progress.ts` (from the fork) — `PrefillProgressTracker` (pure raw-SSE → `prompt_progress` → message logic, fed via `feed(chunk)`, reports through `onUpdate(message | null)`, where `null` means "restore the default"), `WorkingMessageDisplay` (bridges the provider stream, which has no `ExtensionContext`, to the UI), and the shared helpers `formatDuration` and `formatTokenCount`.
- `src/stream.ts` (from the fork) — `teeSse(source, onChunk)` (wraps a response body `ReadableStream` so every chunk passes through unchanged while also being handed to `onChunk`), `createProgressFetch(onChunk, onReset, baseFetch)` (wraps `fetch` so the raw SSE body of a successful response is teed; `onReset` runs at the start of each fetch), and `createProgressStreamSimple(display, baseFetch)` (wraps pi-ai's built-in openai-completions `streamSimple` with a teed `fetch`, preserving the built-in SSE parser).

## Acceptance

- [ ] While prefilling, the keyed UI slot shows the pi-llama-cpp-stats format: `Prefilling... ▓▓▓░░░ 40% · 3.2s · 12.3 tok/s` (20-char bar, space-padded percentage, ETA, live tok/s).
- [ ] Progress comes from the request's own SSE (a teed `options.fetch`), not a global `fetch` monkey-patch.
- [ ] The UI slot returns to default when prefill ends (`processed === total`), when the stream settles, and on abort.
- [ ] The display writes to a **keyed UI slot** (`ctx.ui.setStatus` / `setWidget`), not the shared working message, so it does not fight `pi-llama-cpp-stats`.

## TDD seams

1. `PrefillProgressTracker` (`src/progress.ts`) — pure raw-SSE → `prompt_progress` → message logic. Tested via `feed(chunk)` and the `onUpdate(message | null)` callback.
2. `WorkingMessageDisplay` (`src/progress.ts`) — bridge from the provider stream to the UI slot. Tested via `attach(ctx)` + `set(message | null)`.
3. `createProgressFetch` / `teeSse` (`src/stream.ts`) — wraps `fetch` so the raw SSE body is teed while passing through byte-for-byte. Tested with a fake base `fetch`.
4. `createProgressStreamSimple` (`src/stream.ts`) — the full chain: pi-ai's built-in openai-completions `streamSimple` with a teed `fetch`. Tested with a fake `fetch` returning canned SSE (progress events + completion chunks + `[DONE]`).

### Design notes

- **Keyed UI slot.** `WorkingMessageDisplay` targets a keyed slot (`setStatus` / `setWidget`) rather than `setWorkingMessage`, because the working message is a single last-write-wins slot that `pi-llama-cpp-stats` also writes. Keyed slots are independent per key.
- **`prompt_progress` shape** (llama.cpp `server-task.cpp`): `{ total, cache, processed, time_ms }`. Emitted only during prefill, including an initial 0% event. `processed === total` means prefill complete.
- **Format** (matches pi-llama-cpp-stats): `Prefilling... <bar> <pct>% · <eta> · <tok/s>`. Bar is 20 chars; `pct` is space-padded to 3; ETA is a rate-curve fit over the last 20 deltas with a cumulative-average fallback; tok/s is the live delta rate with a cumulative fallback.
- **Retry safety:** the tracker is reset at the start of each `fetch` call (`onReset`), so a retried request starts fresh.

## Comments
