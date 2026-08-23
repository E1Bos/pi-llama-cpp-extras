# Provider discovery and streamSimple registration

Register a teed `streamSimple` on the `llama-server=<url>` providers that pi-llama-cpp creates, and attach the display, so the progress extra works alongside pi-llama-cpp without modifying it.

Status: open

Depends on tickets 02 and 03 (needs the `createProgressStreamSimple` chain and the shared display).

## The mechanism

Upstream pi-llama-cpp registers one provider per server, `llama-server=<baseUrl>`, with `{name, baseUrl, api, apiKey, models}` and **no** `streamSimple`. Pi merges provider registrations by key: when this package registers the same providerId, its defined keys overlay pi-llama-cpp's and the rest are kept. So this package declares only `{api: "openai-completions", streamSimple: <wrapper>}` and the merge composes them. The composed provider routes through this package's `streamSimple` because `model.api === "openai-completions"`.

## Scope

- **Reconstruct the URL cascade** the same way pi-llama-cpp does: project `.pi/settings.json` `llamaServerUrl` → `LLAMA_SERVER_URL` env → global settings `llamaServerUrl` → default `http://127.0.0.1:8080`, split on `;`.
- For each URL, compute `providerId = "llama-server=" + url` and call `pi.registerProvider(providerId, {api: "openai-completions", streamSimple: createProgressStreamSimple(display)})`.
- Create one shared `WorkingMessageDisplay` and attach it on `before_agent_start` and `turn_start` (`display.attach(ctx)`).

## Acceptance

- [ ] For each configured llama.cpp server, this package registers a `streamSimple` on the `llama-server=<url>` provider that pi-llama-cpp created.
- [ ] The merge is order-independent: whether this package or pi-llama-cpp registers first, the composed provider has both the base config and this package's `streamSimple`.
- [ ] Registering on a providerId pi-llama-cpp did not create (an unreachable server) is a harmless no-op (no model references it, so the composed provider is never used).
- [ ] The display is attached on `before_agent_start` and `turn_start`, so the UI slot is live for the whole turn.

### Design notes

- **Why reconstruct, not query:** `ctx.getScopedModels()` is the user's *selection*, not the full registry, so it is not a reliable discovery surface. Reconstructing the URL cascade mirrors pi-llama-cpp's `ConfigResolver` (~15 lines) and is deterministic. It is the one piece of logic this package duplicates from pi-llama-cpp.
- **Timing:** register the `streamSimple` at extension load. pi-llama-cpp registers its base provider asynchronously after health checks; that call recomposes the provider and picks up this package's `streamSimple`. By the first request the composed provider has both, and the result is order-independent.
- **Multi-server:** one shared display; each provider's `streamSimple` tees its own SSE into it, so the slot reflects whichever request is active.

## Comments
