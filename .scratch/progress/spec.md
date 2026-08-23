# pi-llama-cpp-extras: progress display

`pi-llama-cpp-extras` is a Pi extension package that adds optional extras on top of `pi-llama-cpp` without modifying it. It installs alongside pi-llama-cpp in the same Pi session and coexists with it. This spec covers the first extra: a live **progress display** (prefill bar + thinking counter) for llama.cpp requests.

## Why a separate package

pi-llama-cpp registers one provider per llama.cpp server, with the providerId `llama-server=<baseUrl>`. The upstream package does **not** register a `streamSimple`; its provider config is the plain `{name, baseUrl, api, apiKey, models}` (verified against the published `pi-llama-cpp@0.9.2`).

Pi merges provider registrations by key. When two extensions register the same providerId, the later one's *defined* keys overlay the earlier and everything else is kept. So this package can register `{api: "openai-completions", streamSimple: <wrapper>}` on a `llama-server=<url>` provider and compose with pi-llama-cpp's base provider, without forking pi-llama-cpp and without either package knowing about the other. The display is opt-in: only users who install `pi-llama-cpp-extras` get it, and it does not replace or conflict with upstream pi-llama-cpp.

## How it works

1. **Discovery.** Reconstruct the llama.cpp server URLs the same way pi-llama-cpp does: project `.pi/settings.json` `llamaServerUrl` → `LLAMA_SERVER_URL` env → global settings `llamaServerUrl` → default `http://127.0.0.1:8080`, split on `;`. Compute the providerId `llama-server=<url>` for each.
2. **Tee the SSE.** Register `streamSimple` on each `llama-server=<url>` provider. The wrapper wraps pi-ai's built-in openai-completions `streamSimple` (`@earendil-works/pi-ai/compat`) with a teed `fetch`, so the raw SSE is parsed for progress while the built-in parser is preserved. No global `fetch` monkey-patch.
3. **Request flag.** Add `return_progress: true` to requests that go to a llama.cpp model (via `before_provider_request`, scoped by `ctx.getModel().provider` starting with `llama-server=`), so the SSE carries `prompt_progress`.
4. **Display.** Render the progress in a **keyed UI slot** (`ctx.ui.setStatus` / `setWidget`), not the shared working message. The working message is one last-write-wins slot that `pi-llama-cpp-stats` also writes; a keyed slot is independent per key, so the two never fight.

## The two phases

- **Prefill.** While the prompt is being prefilled, show a bar: `Prefilling... ▓▓▓░░░ 40% · 3.2s · 12.3 tok/s`. Driven by `prompt_progress` in the SSE.
- **Thinking.** While the model reasons, show a counter: `Working... ~1.2k tok · 8s`. Driven by the accumulated reasoning-delta volume (estimated tokens + elapsed time).

Phase order is prefill, then thinking, then the answer. They never overlap (server-guaranteed). The display clears when the answer starts and when the stream settles.

## Reference

The tracker, tee, and display logic is a port of **pi-llama-one** (`~/Code/pi-llama-one`), which is fully implemented and tested there, and of the fork **`~/Code/pi-llama-cpp`** (commits `67f09e4` prefill, `cd6956e` thinking), which already ports it into pi-llama-cpp. The fork's `src/progress.ts` and `src/stream.ts` are self-contained (they import only `@earendil-works/pi-ai/compat`, `@earendil-works/pi-ai`, and node builtins) and lift into this package unchanged. Do not redesign the algorithm or the message format: reproduce the reference behavior exactly.

Only the package-specific wiring is new: the URL-cascade discovery, the `streamSimple` registration, the `return_progress` scoping, and the keyed UI slot.

## Constraints

- Coexists with pi-llama-cpp (complementary, not a fork or replacement).
- Does not modify pi-llama-cpp.
- Opt-in by install.
- The progress logic (trackers, tee, display) is self-contained and lifts from the fork unchanged.
- Duplicates only pi-llama-cpp's URL-cascade resolution (~15 lines) for discovery; it does not duplicate the streaming logic (the `streamSimple` wraps pi-ai's built-in).

## The one assumption to verify

The whole package rests on Pi's provider merge: a second package's `streamSimple` on a `llama-server=<url>` providerId composes with pi-llama-cpp's base provider (which does not define `streamSimple`), regardless of registration order. Verify this in practice (install pi-llama-cpp, drop in a scratch extension that registers `streamSimple` on a live provider, and confirm the tee fires) before building the rest on top of it.
