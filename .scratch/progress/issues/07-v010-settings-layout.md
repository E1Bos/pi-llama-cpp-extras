# Hook into pi-llama-cpp 0.10.0 settings layout

pi-llama-cpp `0.10.0` changed its config schema and provider identity. This package still reconstructs the 0.9.x cascade (`llamaServerUrl` only) and assumes providerIds are always `llama-server=<url>`, so with the new layout its `streamSimple` overlay and `return_progress` scoping silently stop applying and the prefill display never renders.

Status: done

Depends on tickets 04 and 05 (replaces their discovery/scoping behavior).

## What changed in pi-llama-cpp 0.10.0

Verified against the installed package (`~/.pi/agent/npm/node_modules/pi-llama-cpp@0.10.0`, `src/managers/settings.ts`, `src/server.ts`):

1. **Provider identity:** `Server.providerId = customId ?? "llama-server=" + baseUrl`, where `customId` is `llamaSettings.servers[].id` for the entry whose `url` matches. A server configured with an `id` (e.g. `"local"`) is registered under that bare id, not the `llama-server=` form.
2. **URL cascade (first non-empty wins, sources are not merged):**
   - `LLAMA_SERVER_URL` env (split on `;`)
   - `llamaSettings.servers[].url` (each entry split on `;`, flattened)
   - top-level `llamaServerUrl` (legacy)
   - default `http://127.0.0.1:8080`
   Settings are shallow-merged project-over-global: `{...global, ...project}`, so a project `llamaSettings` key wholly replaces the global one.
3. **URL processing** is unchanged: split on `;`, trim, drop empty, strip trailing slashes.

## Scope

- Rewrite `src/discovery.ts` to mirror 0.10.0's `LlamaSettingsManager`: resolve URLs per the new cascade **and** pair each URL with the providerId 0.10.0 would register (`id` override, else `llama-server=<url>`).
- `src/index.ts`: register the `streamSimple` overlay per resolved providerId (not per URL), and scope `before_provider_request` by membership in the resolved providerId set (covers custom ids; keeps passing other providers through unchanged).
- Port/extend the discovery and entry tests to the new API.

## Acceptance

- [ ] For `llamaSettings.servers: [{url, id: "local"}]`, this package registers its overlay on providerId `local`.
- [ ] For a server without `id` (legacy `llamaServerUrl`, env, or default), the overlay still lands on `llama-server=<url>`.
- [ ] `return_progress: true` is added for requests whose model provider is any resolved providerId (custom or `llama-server=`), and the payload passes through untouched otherwise.
- [ ] Project settings' `llamaSettings` wholly replaces global's; env wins over all settings sources.

## Comments

### 2026-08-23 — implemented

TDD: discovery + entry tests rewritten first (14 red), then `src/discovery.ts` (`resolveLlamaServers` returning `{url, providerId}` pairs) and `src/index.ts` (overlay per resolved providerId; `before_provider_request` scoped by a `Set` of resolved providerIds instead of the `llama-server=` prefix). 59/59 tests, `tsc --noEmit` clean. Verified live: the owner ran pi against `pi-llama-cpp@0.10.0` with a `llamaSettings.servers` config using `id: "local"` and the prefill bar renders again.

**Fidelity notes:**

- Mirrors `LlamaSettingsManager` from the installed `pi-llama-cpp@0.10.0`: shallow `{...global, ...project}` merge, env → `servers[].url` → legacy `llamaServerUrl` → default, `;` splitting with trailing-slash stripping, and the `id` lookup against the *merged* `llamaSettings.servers` (so an env URL matching a configured server also picks up its `id`).
- Two deliberate deviations on malformed settings, both safe (unknown providerId = harmless no-op): non-string `servers[].id` falls back to the prefixed id, and non-object/non-string `servers[]` entries are skipped rather than passed through.
- Duplicate URLs collapsing to one providerId are registered once (dedupe by providerId); the overlay is idempotent either way.
- Tickets 04 and 05 are superseded on the discovery/scoping mechanics but their other acceptance items (merge order-independence, keyed display) are unchanged.