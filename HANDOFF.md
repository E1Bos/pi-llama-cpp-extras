# Handoff: pi-llama-cpp-extras

_Written Sun 23 Aug 2026. Repo state: single commit on `main` (spec + tickets + scaffold), no implementation yet. Git identity is configured on the owner's machine and is not stored here._

## What this is

`pi-llama-cpp-extras` is a new Pi extension package that adds **optional extras on top of `pi-llama-cpp`** without forking or modifying it. The first (and so far only) extra is a live **progress display** (prefill bar + thinking counter) for llama.cpp requests. This repo holds only the design and the work items; there is no code yet.

## Where this came from

The owner forked `gsanhueza/pi-llama-cpp` (branch `feat/prompt-process-progress`) to add prefill progress (#2) and thinking progress (#3). The upstream maintainer suggested publishing these as a **separate Pi package** rather than upstreaming into pi-llama-cpp. Investigation confirmed a complementary package is feasible, and it was recommended over keeping a fork.

The load-bearing facts that make the separate package work (each is detailed in the spec or a ticket, listed here so a fresh agent can trust the design without re-deriving it):

- Upstream `pi-llama-cpp@0.9.2` registers its provider as `{name, baseUrl, api, apiKey, models}` and does **not** register a `streamSimple` (verified against the published npm tarball). So this package is *adding* `streamSimple`, not overriding one.
- Pi merges provider registrations **by key, order-independent** (`model-runtime.js` `registerProvider` overlays only defined keys). A second package can add `streamSimple` to a `llama-server=<url>` providerId without replacing pi-llama-cpp's base config.
- `before_provider_request` handlers receive `(event, ctx)`, so `ctx.getModel().provider` (a `llama-server=...` id for llama.cpp models) can scope `return_progress: true` without model discovery. See ticket 05.
- `ctx.getScopedModels()` is the user's *selection*, not the full registry, so provider discovery must **reconstruct the URL cascade** (project `.pi/settings.json` → `LLAMA_SERVER_URL` env → global settings → `http://127.0.0.1:8080`, split on `;`). See ticket 04.
- The display should write to a **keyed UI slot** (`setStatus` / `setWidget`), not the shared working message, to avoid fighting `pi-llama-cpp-stats` (cr4xy), which owns that single last-write-wins slot. See tickets 02 / 03.

## The work product so far

- **Spec:** `.scratch/progress/spec.md` — the coexistence mechanism, the four-step pipeline (discovery → tee → `return_progress` → keyed UI slot), the two phases, the reference, and the one assumption to verify first.
- **Tickets:** `.scratch/progress/issues/01..05` — `01-package-shell`, `02-prefill-progress`, `03-thinking-progress`, `04-provider-discovery`, `05-return-progress`. Build order 01 → 02 → 03 → 04 → 05 (04 depends on 02 and 03). Each has a `Status:` line, reference pointers, acceptance checkboxes, TDD seams, and a `## Comments` section.
- **Scaffold:** `README.md`, `AGENTS.md`, `docs/agents/{issue-tracker,domain}.md`, `.gitignore`.

## Reference implementations (port from these; do not redesign)

- `~/Code/pi-llama-one` — `src/progress.ts`, `src/stream.ts`: the original, fully implemented and tested.
- `~/Code/pi-llama-cpp` (the fork, branch `feat/prompt-process-progress`) — commits `67f09e4` (prefill) and `cd6956e` (thinking) already port the logic into pi-llama-cpp. The fork's `src/progress.ts` and `src/stream.ts` are **self-contained** (they import only `@earendil-works/pi-ai/compat`, `@earendil-works/pi-ai`, and node builtins) and lift into this package unchanged.
- The original ticket specs live in the fork at `~/Code/pi-llama-cpp/.scratch/pi-llama-one/issues/02-prefill-progress.md`, `03-thinking-progress.md`, and `05-model-switch-modes.md`. **Model-switch is a different feature and is intentionally out of scope here.**

## Where to start

1. **De-risk the core assumption first** (the whole package rests on it): install `pi-llama-cpp`, write a scratch extension that `registerProvider`s a `streamSimple` on a live `llama-server=<url>` provider, and confirm the tee actually fires. If the merge does not compose as expected, stop and rework the design before building on it.
2. **Implement the tickets in order, test-first** (each carries TDD seams): scaffold (01), lift `progress.ts` + `stream.ts` and point the display at a keyed UI slot (02, 03), then write `index.ts` with the URL-cascade discovery + `registerProvider` + display attach (04) and the `before_provider_request` scoping (05).
3. **Port the tests** from pi-llama-one / the fork alongside each piece.

## Gotchas

- The package is **complementary**, never a fork or replacement of pi-llama-cpp. It must coexist, and must not double-register the base provider config pi-llama-cpp already owns.
- Only the URL-cascade resolution (~15 lines) is duplicated from pi-llama-cpp. The streaming logic is **not** duplicated: the `streamSimple` wraps pi-ai's built-in openai-completions stream.
- Registering on a providerId pi-llama-cpp did not create (an unreachable server) is a harmless no-op.
- Optional follow-up: propose a small upstream change to pi-llama-cpp that emits its provider IDs on `pi.events`, so this package (and future extras) can discover them without reconstructing config.

## Sensitive info

Redacted: the repo's local git identity (author name and email) is set on the owner's machine and is not stored in this document. No API keys, credentials, or tokens appear anywhere in this repo.

## Suggested skills

- **tdd** — build each ticket test-first; the tickets carry explicit TDD seams.
- **diagnosing-bugs** — if the de-risk step fails or a lifted test breaks, run the diagnosis loop.
- **research** — re-verify pi / pi-ai SDK internals (provider merge, `before_provider_request`, `getScopedModels`) if the de-risk result is surprising.
- **context7-docs** — look up current `@earendil-works/pi-ai` / `@earendil-works/pi-coding-agent` SDK APIs when writing `index.ts`.
- **code-review** — once a ticket is implemented, review it against the spec and the reference implementation.
- **unslop** — always applies to any writing (spec edits, commit messages, docs).
