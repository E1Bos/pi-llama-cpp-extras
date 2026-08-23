# return_progress scoping

Add `return_progress: true` to requests that go to a llama.cpp model, so the SSE carries `prompt_progress`.

Status: done

Depends on ticket 04 (the package is wired and the entry point is in place).

## The mechanism

`before_provider_request` handlers receive `(event, ctx)`, and a handler's return value replaces the payload for downstream handlers and for the request itself. `ctx.getModel()` is the model the request is about to use, and its `provider` is `llama-server=<url>` for llama.cpp models. Scoping by the provider means this package never touches non-llama requests.

## Scope

- `pi.on("before_provider_request", (event, ctx) => ...)`: if `ctx.getModel()?.provider` starts with `llama-server=`, return `{...event.payload, return_progress: true}`; otherwise return `event.payload` unchanged.

## Acceptance

- [x] A request to a `llama-server=<url>` model carries `return_progress: true` in its payload.
- [x] A request to a non-llama model (e.g. an Anthropic or OpenAI model) is passed through unchanged.
- [x] Without `return_progress: true` the SSE never carries `prompt_progress`, so ticket 02's bar would never move; with it, the bar is driven.

### Design notes

- **Scoped by provider, not model id.** The payload carries the model id but not the provider; `ctx.getModel().provider` is the reliable signal. This avoids fetching `/v1/models` to build a model-id set.
- **Chaining:** other extensions' `before_provider_request` handlers run too (the runner chains them and forwards the current payload). This package's handler returns the augmented payload so downstream handlers and the outgoing request see it.

## Comments

### 2026-08-23 — implemented (commit `399c769`)

TDD in one red→green round: scope behavior test in `tests/entry.test.ts` → handler in `src/index.ts`. 52/52 tests, `tsc --noEmit` clean.

**Deviations:**

1. **`ctx.model` instead of `ctx.getModel()`.** The ticket names `ctx.getModel()`, but the `ExtensionContext` of the installed pi-coding-agent `0.84.2` (our dev-dep, matching the peer range) exposes the current model as the `ctx.model` property; `getModel()` exists only on the standalone `ExtensionContextActions` interface, which nothing in this version references and the runtime ctx built by `runner.createContext()` does not include (it builds a `model` getter over `runner.getModel()`). Same semantics: "the model the request is about to use." If pi adds `getModel()` to the handler ctx in a future release, the one-line read here can switch over.
2. **Payload cast.** `event.payload` is typed `unknown`; the handler spreads it after a `Record<string, unknown>` cast — pi always passes the assembled request body object, so the cast is safe at runtime.

**Verified:**

- **Acceptance 1** — the behavior test asserts a `llama-server=<url>` model gets a new payload object with `return_progress: true` and that the original payload is not mutated.
- **Acceptance 2** — non-llama (`anthropic`) and missing-model requests pass through by identity (the same object, unchanged), and an anchored-prefix negative (`x-llama-server=...`) is not scoped.
- **Acceptance 3** — the flag→SSE half is llama.cpp's documented behavior (`prompt_progress` only emitted when requested) and is verified by design: ticket 02's tests cover the SSE→bar direction (`prompt_progress` drives `PrefillProgressTracker`), this ticket covers the request-flag direction.
- **Chaining** — verified in pi-coding-agent `0.84.2` source (`dist/core/extensions/runner.js` `emitBeforeProviderRequest`): handlers run across extensions in order, each receiving `{type, payload: currentPayload}`, and a non-`undefined` handler result replaces `currentPayload` — so our augmented payload reaches downstream handlers and the outgoing request.
