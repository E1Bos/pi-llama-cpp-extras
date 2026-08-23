# pi-llama-cpp-extras

Optional extras for the [pi-llama-cpp](https://github.com/gsanhueza/pi-llama-cpp) Pi extension. This package installs *alongside* pi-llama-cpp (it does not fork or replace it) and adds opt-in behavior that not every user wants.

## First extra: progress display

While a prompt is being prefilled and while the model reasons, show live progress in a keyed UI slot (a status line or widget), without fighting `pi-llama-cpp-stats` for the shared working message.

- **Prefill.** `Prefilling... ▓▓▓░░░ 40% · 3.2s · 12.3 tok/s` (driven by `prompt_progress` in the SSE).
- **Thinking.** `Working... ~1.2k tok · 8s` (driven by reasoning-delta volume).

## How it coexists with pi-llama-cpp

Upstream pi-llama-cpp registers one provider per llama.cpp server (`llama-server=<url>`) and does **not** register a `streamSimple`. This package registers a teed `streamSimple` on those same providerIds. Pi merges provider registrations by key, so the package's `streamSimple` composes with pi-llama-cpp's base provider without either one knowing about the other.

## Status

In progress. The design is in `.scratch/progress/spec.md`; the work items are in `.scratch/progress/issues/`.
