# Prefill progress in a keyed UI slot

Tee the raw SSE of a llama.cpp request, parse `prompt_progress`, and render a live progress bar in a keyed UI slot while prefilling.

Status: done

Depends on ticket 01 (package shell).

## Reference implementation

The source of truth is **pi-llama-one** (`~/Code/pi-llama-one`), fully implemented and tested there, and the fork **`~/Code/pi-llama-cpp`** (commit `67f09e4`), which already ports it into pi-llama-cpp. Do not redesign the algorithm or the message format: reproduce the reference behavior exactly.

**Files to lift** (both self-contained, importing only `@earendil-works/pi-ai/compat`, `@earendil-works/pi-ai`, and node builtins):

- `src/progress.ts` (from the fork) — `PrefillProgressTracker` (pure raw-SSE → `prompt_progress` → message logic, fed via `feed(chunk)`, reports through `onUpdate(message | null)`, where `null` means "restore the default"), `WorkingMessageDisplay` (bridges the provider stream, which has no `ExtensionContext`, to the UI), and the shared helpers `formatDuration` and `formatTokenCount`.
- `src/stream.ts` (from the fork) — `teeSse(source, onChunk)` (wraps a response body `ReadableStream` so every chunk passes through unchanged while also being handed to `onChunk`), `createProgressFetch(onChunk, onReset, baseFetch)` (wraps `fetch` so the raw SSE body of a successful response is teed; `onReset` runs at the start of each fetch), and `createProgressStreamSimple(display, baseFetch)` (wraps pi-ai's built-in openai-completions `streamSimple` with a teed `fetch`, preserving the built-in SSE parser).

## Acceptance

- [x] While prefilling, the keyed UI slot shows the pi-llama-cpp-stats format: `Prefilling... ▓▓▓░░░ 40% · 3.2s · 12.3 tok/s` (20-char bar, space-padded percentage, ETA, live tok/s).
- [x] Progress comes from the request's own SSE (a teed `options.fetch`), not a global `fetch` monkey-patch.
- [x] The UI slot returns to default when prefill ends (`processed === total`), when the stream settles, and on abort.
- [x] The display writes to a **keyed UI slot** (`ctx.ui.setStatus` / `setWidget`), not the shared working message, so it does not fight `pi-llama-cpp-stats`.

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

### 2026-08-23 — implemented (commit `1455921`)

Lifted from the fork at commit `67f09e4` (the prefill-only source; the fork's HEAD has ticket 03's thinking tracker layered on top, which is out of scope here). TDD in four red→green rounds: tracker → display → `teeSse`/`createProgressFetch` → `createProgressStreamSimple`. 25/25 tests, `tsc --noEmit` clean.

**Deviations from the literal reference (all mandated or pinned by this ticket):**

1. **Keyed slot instead of the working message.** `WorkingMessageDisplay` targets `ctx.ui.setStatus(key, text)` (key `pi-llama-cpp-extras:progress`, `SLOT_KEY`) rather than `ui.setWorkingMessage`, per the design note and acceptance criterion 4. `setWidget` was not used: `setStatus` is the keyed single-line slot, which is all a progress line needs. The class keeps the fork's name for seam continuity; the doc comment records the name/target mismatch.
2. **Omitted the fork's `attachToWorkingMessage` transient path.** It exists for pi-llama-cpp's model-loading indicator ("Loading model...") — a pi-llama-cpp feature this package's tickets don't cover. Ticket 05 can re-add an equivalent if `return_progress` scoping needs it.
3. **`formatTokenCount` is exported but unused in this ticket.** The ticket's lift list includes it and ticket 03's thinking tracker consumes it; the doc comment records this.
4. **Abort test added beyond the fork's suite.** Acceptance criterion 3 explicitly requires slot-clear on abort. Verified against pi-ai `0.84.2` source: an aborted signal makes the openai-completions stream push an `error` event (`stopReason: "aborted"`) and `stream.end()`, and `stream.result()` resolves on that terminal event, so the reference `result().then(() => { prefill.finish(); display.finish(); })` chain runs on completion, error, and abort alike. Pinned by a new abort test (fake fetch + `AbortController`).

**Verified:** tracker renders the exact reference format (`Prefilling... [20-char bar]  NN% · <eta> · <tok/s>`, rate-curve-fit ETA, delta tok/s, split-chunk reassembly, retry reset); the teed fetch is byte-identical pass-through with per-fetch `onReset`; the slot is cleared on prefill end, stream settle, and abort; the display writes only to the keyed slot (tested against a ctx exposing both `setStatus` and `setWorkingMessage`).

**Entry unchanged on purpose:** `src/index.ts` stays a placeholder. Per ticket 01's comment, the entry is wired to pi-llama-cpp's providers in ticket 04 (provider discovery) / ticket 05 (`return_progress`); this ticket delivers the modules and their seams only. Ticket 03 extends the tee with the thinking tracker.

### 2026-08-23 — display target changed to the working message line (commit `8a5ffcd`)

User request after the fact: the prefill bar and thinking counter should appear where pi's own `Working...` spinner line sits (the `⠼` line in the chat area), not in the footer status bar. `WorkingMessageDisplay` now targets `ui.setWorkingMessage(message?)` — the line pi renders as `WorkingStatusIndicator(ui, workingMessage ?? "Working...")` (verified in pi-coding-agent `0.84.2` `modes/interactive/interactive-mode.js`) — instead of the keyed `ui.setStatus` slot; `SLOT_KEY` is dropped and the "keyed slot" doc wording is updated throughout (`progress.ts`, `stream.ts`, `index.ts`). Writing `undefined` restores pi's default `Working...` text, so settling/aborting reverts to pi's own indicator, and the tracker's generic tool-call message is literally `Working...`, so tool calls look unchanged. The acceptance wording above (criterion 4, keyed slot) is superseded by this user request; the phase exclusivity and clear-on-settle behavior are unchanged and re-pinned by the updated tests.
