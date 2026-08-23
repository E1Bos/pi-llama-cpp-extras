# Thinking progress in the keyed UI slot

While the model emits reasoning tokens, show a live counter (estimated thinking tokens + elapsed thinking time) in the keyed UI slot.

Status: open

Depends on ticket 02 (it reuses ticket 02's teed stream and display, and generalises the teed fetch so one stream drives both the prefill and the thinking trackers).

## Reference implementation

Port `ThinkingProgressTracker` from **pi-llama-one** (`~/Code/pi-llama-one`) / the fork **`~/Code/pi-llama-cpp`** (commit `cd6956e`). Do not redesign the counter logic or the message format: reproduce the reference behavior exactly.

**Files to change:**

- `src/progress.ts` — add `ThinkingProgressTracker` (parses raw SSE, tracks the reasoning phase, renders the counter; pure, fed via `feed(chunk)`, reports through `onUpdate(message | null)`, clock injected for testability and defaulting to `Date.now`).
- `src/stream.ts` — generalise `createProgressFetch` so one teed raw-SSE stream drives both the prefill and the thinking trackers (it takes `onChunk` + `onReset`), and update `createProgressStreamSimple` to feed **both** trackers and `finish()` both when the stream settles.

## Acceptance

- [ ] During the thinking phase, the UI slot shows `Working... ~1.2k tok · 8s`.
- [ ] The token count is estimated from the accumulated reasoning-delta volume (~4 chars per token; llama.cpp gives no exact per-phase count).
- [ ] Phase order is prefill, then thinking, then the answer; they never overlap, and the counter clears when the answer starts.
- [ ] While the model is making a tool call, the UI slot shows `Working...` without thinking stats (the stats do not freeze).

## TDD seams

1. `ThinkingProgressTracker` (`src/progress.ts`) — pure raw-SSE → counter logic. Renders `Working... ~N tok · Xs` while reasoning deltas arrive; emits `null` on the first non-empty `content` delta (the answer) and on `finish()`.
2. `createProgressStreamSimple` (`src/stream.ts`) — feeds both trackers from the teed `fetch`; a prefill → reasoning → content SSE drives the UI slot through the bar, then the counter, then restores it (undefined) on settle.

### Design notes

- **Reasoning field:** read the first non-empty of `reasoning_content` / `reasoning` / `reasoning_text` (llama.cpp emits `choices[0].delta.reasoning_content`), same priority as pi-ai's openai-completions parser, so a differently-shaped endpoint still works and a provider emitting both fields is not double-counted.
- **Token estimate:** `round(accumulatedReasoningChars / 4)`. Human-readable: `<1000` → `850`, `>=1000` → `1.2k` (one decimal, trailing `.0` stripped).
- **Elapsed time:** client-timed from the first reasoning delta (injected `now()`), since no server field anchors the thinking start.

## Comments
