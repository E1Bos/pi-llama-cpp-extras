# Provider discovery and streamSimple registration

Register a teed `streamSimple` on the `llama-server=<url>` providers that pi-llama-cpp creates, and attach the display, so the progress extra works alongside pi-llama-cpp without modifying it.

Status: done

Depends on tickets 02 and 03 (needs the `createProgressStreamSimple` chain and the shared display).

## The mechanism

Upstream pi-llama-cpp registers one provider per server, `llama-server=<baseUrl>`, with `{name, baseUrl, api, apiKey, models}` and **no** `streamSimple`. Pi merges provider registrations by key: when this package registers the same providerId, its defined keys overlay pi-llama-cpp's and the rest are kept. So this package declares only `{api: "openai-completions", streamSimple: <wrapper>}` and the merge composes them. The composed provider routes through this package's `streamSimple` because `model.api === "openai-completions"`.

## Scope

- **Reconstruct the URL cascade** the same way pi-llama-cpp does: project `.pi/settings.json` `llamaServerUrl` → `LLAMA_SERVER_URL` env → global settings `llamaServerUrl` → default `http://127.0.0.1:8080`, split on `;`.
- For each URL, compute `providerId = "llama-server=" + url` and call `pi.registerProvider(providerId, {api: "openai-completions", streamSimple: createProgressStreamSimple(display)})`.
- Create one shared `WorkingMessageDisplay` and attach it on `before_agent_start` and `turn_start` (`display.attach(ctx)`).

## Acceptance

- [x] For each configured llama.cpp server, this package registers a `streamSimple` on the `llama-server=<url>` provider that pi-llama-cpp created.
- [x] The merge is order-independent: whether this package or pi-llama-cpp registers first, the composed provider has both the base config and this package's `streamSimple`.
- [x] Registering on a providerId pi-llama-cpp did not create (an unreachable server) is a harmless no-op (no model references it, so the composed provider is never used).
- [x] The display is attached on `before_agent_start` and `turn_start`, so the UI slot is live for the whole turn.

### Design notes

- **Why reconstruct, not query:** `ctx.getScopedModels()` is the user's *selection*, not the full registry, so it is not a reliable discovery surface. Reconstructing the URL cascade mirrors pi-llama-cpp's `ConfigResolver` (~15 lines) and is deterministic. It is the one piece of logic this package duplicates from pi-llama-cpp.
- **Timing:** register the `streamSimple` at extension load. pi-llama-cpp registers its base provider asynchronously after health checks; that call recomposes the provider and picks up this package's `streamSimple`. By the first request the composed provider has both, and the result is order-independent.
- **Multi-server:** one shared display; each provider's `streamSimple` tees its own SSE into it, so the slot reflects whichever request is active.

## Comments

### 2026-08-23 — implemented (commit `98d0651`)

TDD in two red→green rounds: cascade unit tests → `src/discovery.ts`; entry behavior tests → `src/index.ts`. 51/51 tests, `tsc --noEmit` clean.

**Deviations / additions beyond the ticket's literal scope:**

1. **Legacy `.pi/llama-server.json` fallback omitted.** pi-llama-cpp's `ConfigResolver` also reads the deprecated legacy file (with a deprecation warning); the ticket's cascade list (project `.pi/settings.json` → env → global → default) omits it, so this package skips the deprecated path. If pi-llama-cpp ever removes the fallback, the two stay in sync.
2. **Settings access via pi-coding-agent's `SettingsManager`.** The defaults read pi's real settings through `SettingsManager.create(process.cwd(), getAgentDir())` (the same mechanism pi-llama-cpp uses, so both packages see identical files), with `projectUrl`/`globalUrl`/`env` injectable through `createProgressEntry(deps)` for tests. The entry is factored as `createProgressEntry(deps)` + a thin default export; `stringSetting` treats non-string/empty values as unset.
3. **Behavior test seam.** The entry's `streamSimple` tees through `createProgressStreamSimple`'s default `baseFetch` (`globalThis.fetch`), and the teed wrapper overrides any option-level `fetch`, so the attach-on-events test stubs `globalThis.fetch` before the entry runs — the faithful seam for the production default path.

**Verified:**

- **Acceptance 1** — the entry test registers one `streamSimple` overlay per cascaded URL with pi-llama-cpp's exact providerId format (`llama-server=<url>`), asserting the overlay carries only `{api, streamSimple}` so the merge keeps the base config.
- **Acceptance 2** — verified in pi-coding-agent `0.84.2` source (`dist/core/model-runtime.js` `registerProvider`): "Re-registration merges defined values over the previous registration and preserves undefined ones" — `{...previous}` plus a defined-key loop, symmetric in whichever extension registers first. The `pi.registerProvider` doc also confirms load-time registrations are queued and applied once the runner binds context, so the composed provider has both by the first request (the design note's timing).
- **Acceptance 3** — registering an unknown providerId is a no-op with respect to models: `validateExtensionProvider` accepts new providers, the composed provider has no `models` (nothing references it), so it is never routed to; verified by the same source path.
- **Acceptance 4** — the behavior test attaches via both captured event handlers, then runs the registered provider's `streamSimple` against a stubbed fetch and asserts the keyed slot receives a `Prefilling...` write and is cleared (`undefined`) on settle.

**Cascade fidelity** — `resolveJoinedLlamaServerUrl` mirrors `ConfigResolver.extractJoinedUrls` (first non-empty wins, empty string = unset, no merging) and `splitLlamaServerUrls` mirrors `resolveUrls` (split on `;`, trim, drop empty, strip trailing slashes) — the trailing-slash stripping is load-bearing because pi-llama-cpp builds providerIds from the processed URLs.
