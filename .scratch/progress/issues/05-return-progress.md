# return_progress scoping

Add `return_progress: true` to requests that go to a llama.cpp model, so the SSE carries `prompt_progress`.

Status: open

Depends on ticket 04 (the package is wired and the entry point is in place).

## The mechanism

`before_provider_request` handlers receive `(event, ctx)`, and a handler's return value replaces the payload for downstream handlers and for the request itself. `ctx.getModel()` is the model the request is about to use, and its `provider` is `llama-server=<url>` for llama.cpp models. Scoping by the provider means this package never touches non-llama requests.

## Scope

- `pi.on("before_provider_request", (event, ctx) => ...)`: if `ctx.getModel()?.provider` starts with `llama-server=`, return `{...event.payload, return_progress: true}`; otherwise return `event.payload` unchanged.

## Acceptance

- [ ] A request to a `llama-server=<url>` model carries `return_progress: true` in its payload.
- [ ] A request to a non-llama model (e.g. an Anthropic or OpenAI model) is passed through unchanged.
- [ ] Without `return_progress: true` the SSE never carries `prompt_progress`, so ticket 02's bar would never move; with it, the bar is driven.

### Design notes

- **Scoped by provider, not model id.** The payload carries the model id but not the provider; `ctx.getModel().provider` is the reliable signal. This avoids fetching `/v1/models` to build a model-id set.
- **Chaining:** other extensions' `before_provider_request` handlers run too (the runner chains them and forwards the current payload). This package's handler returns the augmented payload so downstream handlers and the outgoing request see it.

## Comments
