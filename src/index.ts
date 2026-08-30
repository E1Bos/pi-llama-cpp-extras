/**
 * Extension entry: registers a teed `streamSimple` on the providers that
 * pi-llama-cpp `0.10.0` creates, and attaches the shared progress display to
 * pi's working message line - the `\u243C Working...` spinner line - so the
 * progress extra works alongside pi-llama-cpp without modifying it.
 *
 * pi-llama-cpp registers one provider per server, under `server.id` when
 * configured (e.g. `"local"`) and `llama-server=<baseUrl>` otherwise, with
 * `{name, baseUrl, api, apiKey, models}` and no `streamSimple`. Pi merges
 * provider registrations by key: registering the same providerId overlays
 * the defined keys on the previous registration (in either order, whichever
 * extension registers first), so this package declares only the overlay keys
 * and the composed provider keeps pi-llama-cpp's base config while routing
 * through this package's `streamSimple` (the provider's `api` is
 * `openai-completions`).
 *
 * Registering on a providerId pi-llama-cpp did not create (an unreachable
 * server) is a harmless no-op: no model references it, so the composed
 * provider is never used.
 *
 * The servers and providerIds are reconstructed (not queried) the same way
 * pi-llama-cpp's `LlamaSettingsManager` does: `LLAMA_SERVER_URL` env →
 * `llamaSettings.servers[].url` → legacy top-level `llamaServerUrl` →
 * `http://127.0.0.1:8080`, split on `;`, with `id` from a matching
 * `llamaSettings.servers` entry overriding the `llama-server=<url>` id.
 * `ctx.getScopedModels()` is the user's *selection*, not the full registry,
 * so it is not a reliable discovery surface.
 *
 * Multi-server: one shared display; each provider's `streamSimple` tees its
 * own SSE into it, so the working message reflects whichever request is
 * active.
 *
 * The `before_provider_request` handler scopes `return_progress: true` onto
 * requests whose model's provider is one of the resolved providerIds (a
 * custom id like `local`, or the `llama-server=<url>` form). Without the
 * flag, llama.cpp never emits `prompt_progress`, so ticket 02's bar would
 * never move.
 */
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveLlamaServers } from "./discovery";
import { WorkingMessageDisplay } from "./progress";
import { createProgressStreamSimple } from "./stream";

export interface ProgressEntryDeps {
	/** Reads the project settings (default: pi's project settings). */
	projectSettings?: () => Record<string, unknown> | null;
	/** Reads the global settings (default: pi's global settings). */
	globalSettings?: () => Record<string, unknown> | null;
	/** Environment source (default: `process.env` for `LLAMA_SERVER_URL`). */
	env?: Record<string, string | undefined>;
}

/**
 * Build the extension factory. `deps` are injectable for tests; the defaults
 * read pi's real project/global settings and `process.env`.
 */
export function createProgressEntry(deps: ProgressEntryDeps = {}) {
	const env = deps.env ?? process.env;
	let settingsManager: SettingsManager | undefined;
	const manager = () =>
		(settingsManager ??= SettingsManager.create(process.cwd(), getAgentDir()));

	const projectSettings =
		deps.projectSettings ?? (() => manager().getProjectSettings() as Record<string, unknown> | null);
	const globalSettings =
		deps.globalSettings ?? (() => manager().getGlobalSettings() as Record<string, unknown> | null);

	return (pi: ExtensionAPI) => {
		const servers = resolveLlamaServers({
			project: projectSettings(),
			global: globalSettings(),
			env,
		});
		const providerIds = new Set(servers.map((s) => s.providerId));

		// One shared display for all providers (multi-server: the working
		// message reflects whichever request is active).
		const display = new WorkingMessageDisplay();

		// Overlay the teed streamSimple on pi-llama-cpp's base provider config,
		// one provider per configured server, under the same providerId
		// pi-llama-cpp uses (`id` override or `llama-server=<url>`).
		for (const { providerId } of servers) {
			pi.registerProvider(providerId, {
				api: "openai-completions",
				streamSimple: createProgressStreamSimple(display),
			});
		}

		// llama.cpp only emits `prompt_progress` when the request asks for
		// it, so scope `return_progress: true` to the resolved providerIds.
		// Other providers' payloads pass through unchanged. The handler's
		// return value replaces the payload for downstream handlers and the
		// request.
		pi.on("before_provider_request", (event, ctx) => {
			// `ctx.model` is the model the request is about to use; for
			// llama.cpp models its provider is one of the resolved ids.
			const provider = ctx.model?.provider;
			if (provider && providerIds.has(provider)) {
				return { ...(event.payload as Record<string, unknown>), return_progress: true };
			}
			return event.payload;
		});

		// Attach on events that carry the UI context, so the working message
		// line is live for the whole turn.
		pi.on("before_agent_start", (_event, ctx) => display.attach(ctx));
		pi.on("turn_start", (_event, ctx) => display.attach(ctx));
	};
}

export default (pi: ExtensionAPI) => {
	createProgressEntry()(pi);
};
