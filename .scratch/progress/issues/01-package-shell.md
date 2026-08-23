# Package shell

Set up the `pi-llama-cpp-extras` package so the progress extra can be built and tested in isolation.

Status: open

## Scope

- `package.json`: name `pi-llama-cpp-extras`, `pi.extensions` pointing at `./src/index.ts`, peer deps on `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` (both `>=0.84.0`), plus a note in the README that `pi-llama-cpp` is required (it provides the `llama-server=<url>` providers this package attaches to).
- `tsconfig.json` and `vitest.config.ts` (mirror the fork's setup).
- `src/index.ts`: an empty extension entry (`export default (pi) => {}`) that later tickets fill in.
- `tests/` with a passing placeholder test.

## Acceptance

- [x] `npm install` succeeds and resolves the pi-ai and pi-coding-agent peer deps (both resolve to 0.84.2).
- [x] `tsc --noEmit` is clean.
- [x] `vitest run` passes (placeholder test green, 2/2).
- [x] `pi.extensions` points at the entry so Pi loads the package as an extension.

## Notes

The entry is a placeholder on purpose. Ticket 02 (prefill) introduces the display and the tee; ticket 03 (thinking) extends the tee; ticket 04 (provider discovery) and ticket 05 (return_progress) wire the entry to pi-llama-cpp's providers.

## Comments

### 2026-08-23: implemented (commit `5985b3a`)

All acceptance criteria verified. Two literal deviations from the ticket text, both forced by the toolchain and behaviorally identical:

- The entry is typed `(_pi: ExtensionAPI): void => {}` (from `@earendil-works/pi-coding-agent`) rather than `(pi) => {}` — the untyped form does not compile under `strict: true` (noImplicitAny), which the `tsc --noEmit` acceptance criterion requires. **Ticket 02+: the entry already has the `ExtensionAPI` type imported.**
- `tsconfig.json` uses `module: "esnext"` instead of the fork's `"commonjs"` — the fork's `commonjs` + `moduleResolution: "bundler"` combination is rejected by the installed TypeScript (TS5095). Everything else in the tsconfig/vitest config mirrors the fork; the `esnext` variant is the one `pi-llama-one` uses.

Also beyond the ticket's literal scope list: `devDependencies` pin `@earendil-works/pi-ai`/`pi-coding-agent` at `0.84.2` plus `typescript`, `@types/node`, `vitest` (needed for the typecheck/test acceptance criteria; pattern from `pi-llama-one`), and `test`/`typecheck` scripts. Tests import `describe`/`expect`/`it` from `"vitest"` explicitly (as both reference repos do) so `tsc` sees them, even though `vitest.config.ts` keeps `globals: true`.

Note: `package-lock.json` is gitignored in this repo (pre-existing `.gitignore`), so installs are not lockfile-pinned; the dev-deps pin the pi packages exactly as the compensating control.
