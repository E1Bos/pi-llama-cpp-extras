# Package shell

Set up the `pi-llama-cpp-extras` package so the progress extra can be built and tested in isolation.

Status: open

## Scope

- `package.json`: name `pi-llama-cpp-extras`, `pi.extensions` pointing at `./src/index.ts`, peer deps on `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` (both `>=0.84.0`), plus a note in the README that `pi-llama-cpp` is required (it provides the `llama-server=<url>` providers this package attaches to).
- `tsconfig.json` and `vitest.config.ts` (mirror the fork's setup).
- `src/index.ts`: an empty extension entry (`export default (pi) => {}`) that later tickets fill in.
- `tests/` with a passing placeholder test.

## Acceptance

- [ ] `npm install` succeeds and resolves the pi-ai and pi-coding-agent peer deps.
- [ ] `tsc --noEmit` is clean.
- [ ] `vitest run` passes (placeholder test green).
- [ ] `pi.extensions` points at the entry so Pi loads the package as an extension.

## Notes

The entry is a placeholder on purpose. Ticket 02 (prefill) introduces the display and the tee; ticket 03 (thinking) extends the tee; ticket 04 (provider discovery) and ticket 05 (return_progress) wire the entry to pi-llama-cpp's providers.

## Comments
