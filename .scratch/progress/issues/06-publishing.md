# Publish pi-llama-cpp-extras to npm and the pi.dev package gallery

How to publish the package so users can `pi install` it, and how it shows up in the pi.dev gallery. Research ticket: the steps here are verified against pi-coding-agent `0.84.2` source and the npm registry, but nothing has been published yet.

Status: open

Depends on the maintainer approving the package name in the upstream issue (the npm name `pi-llama-cpp-extras` is exactly what is under discussion; a different name changes step 2).

## How pi installs npm packages (verified in `dist/core/package-manager.js`)

- `pi install npm:<pkg>` installs into a managed root (`~/.pi/agent/npm` user scope, `.pi/npm` project scope) via `npm install <spec> --prefix <root> --legacy-peer-deps` (npm path; bun/pnpm have equivalents).
- Consequences:
  - `devDependencies` in the published package.json are **never installed** by pi (npm only installs a dependency's `dependencies`). Keeping the pi packages in `devDependencies` for local dev is safe.
  - `--legacy-peer-deps` means our `@earendil-works/pi-*` `peerDependencies` are **not auto-installed**; pi resolves them at runtime through loader aliases / virtual modules to its bundled copies. Do not add them to `dependencies` (they would be bundled, giving separate module instances).
  - The `pi.extensions` entry (`./src/index.ts`) is loaded from the package root as TS source; no build step or `dist/` needed.

## Steps

1. **Prereqs**: npm account (npmjs.com), `npm login` (browser flow; if the account has 2FA, `npm publish` prompts for an OTP). Confirm the name is free: `npm view pi-llama-cpp-extras` (currently 404, verified 2026-08-23).
2. **Prepare `package.json`**:
   - Add `files: ["src", "README.md", "LICENSE", "tsconfig.json"]` so the tarball stays slim (without it, npm packs the whole directory: `tests/`, `docs/`, `.scratch/`, `HANDOFF.md`, `package-lock.json`). `node_modules` is always excluded.
   - Add a `LICENSE` file (MIT text, e.g. copy from `~/Code/pi-llama-cpp/LICENSE.md`; `license: MIT` is already declared but npm warns without the file).
   - Add `repository` (and optionally `author`) metadata.
   - Leave `devDependencies` and `peerDependencies` as they are (see above).
3. **Dry run**: `npm publish --dry-run` to inspect the exact tarball contents. Nothing is uploaded.
4. **Publish**: `npm publish` (unscoped names are public by default; `--access public` only applies to scoped names). Commit the tree first; publish from a clean state.
5. **Verify**: `npm view pi-llama-cpp-extras`; then test from a user's side with `pi install npm:pi-llama-cpp-extras`, `pi list`, and a live run `pi -e npm:pi-llama-cpp-extras` alongside `pi-llama-cpp` to see the working-message progress.

## pi.dev gallery

No separate submission. The gallery at `pi.dev/packages` displays npm packages tagged with the `pi-package` keyword, which `package.json` already has. Optional: add `"pi": { "image": "<url>" }` (PNG/JPEG/GIF/WebP) or `"video": "<url>"` (MP4) for a gallery preview; video takes precedence if both are set.

## Release workflow

- First release: `npm publish` at `0.1.0` (version already set).
- Subsequent: `npm version patch|minor` (bumps `package.json` and tags git; needs a clean tree), then `npm publish`.
- Consumers: `pi install npm:pi-llama-cpp-extras` (unpinned, updated by `pi update --extensions`); `pi install npm:pi-llama-cpp-extras@0.1.0` pins a version, which `pi update` skips; `pi install -l` writes project settings instead of user settings.
- The package is functionally dependent on `pi-llama-cpp` (it overlays the `llama-server=<url>` providers that package registers) but does not import it, so it stays a README note rather than a declared dependency.

## Caveats

- Unscoped npm names are global and first-come-first-served; unpublish is restricted (72h window after a fresh publish, then only `npm deprecate`). Publish only once the README is presentable.
- `pi update`/update checks skip unpinned-only specs; pinned installs stay put by design.

## Acceptance

- [ ] `npm view pi-llama-cpp-extras` shows the published version.
- [ ] `npm publish --dry-run` output contains only `src/`, `README.md`, `LICENSE`, `tsconfig.json`, `package.json`.
- [ ] Fresh `pi install npm:pi-llama-cpp-extras` installs cleanly (no peer-resolution errors) and `pi list` shows it.
- [ ] With a live `llama-server`, `pi -e` runs of both packages show the working-message progress line.
- [ ] The package appears at `pi.dev/packages`.

## Comments

- Verified against pi-coding-agent `0.84.2` `dist/core/package-manager.js` (`getNpmInstallArgs`: `["install", ...specs, "--prefix", installRoot, "--legacy-peer-deps"]` for npm; comment in source confirms loader-alias resolution of pi peers) and `docs/packages.md` (gallery + install syntax). Name availability checked via `npm view` on 2026-08-23.
