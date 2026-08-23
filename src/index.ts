/**
 * Extension entry: registers a teed `streamSimple` on the `llama-server=<url>`
 * providers that pi-llama-cpp creates, and attaches the shared progress
 * display, so the progress extra works alongside pi-llama-cpp without
 * modifying it.
 *
 * Upstream pi-llama-cpp registers one provider per server,
 * `llama-server=<baseUrl>`, with `{name, baseUrl, api, apiKey, models}` and
 * no `streamSimple`. Pi merges provider registrations by key: registering the
 * same providerId overlays the defined keys on the previous registration (in
 * either order, whichever extension registers first), so this package
 * declares only the overlay keys and the composed provider keeps
 * pi-llama-cpp's base config while routing through this package's
 * `streamSimple` (the provider's `api` is `openai-completions`).
 *
 * Registering on a providerId pi-llama-cpp did not create (an unreachable
 * server) is a harmless no-op: no model references it, so the composed
 * provider is never used.
 *
 * The URL cascade is reconstructed (not queried) the same way pi-llama-cpp's
 * `ConfigResolver` does it: project `.pi/settings.json` `llamaServerUrl` →
 * `LLAMA_SERVER_URL` env → global settings `llamaServerUrl` →
 * `http://127.0.0.1:8080`, split on `;`. `ctx.getScopedModels()` is the
 * user's *selection*, not the full registry, so it is not a reliable
 * discovery surface.
 *
 * Multi-server: one shared display; each provider's `streamSimple` tees its
 * own SSE into it, so the slot reflects whichever request is active.
 */
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	resolveJoinedLlamaServerUrl,
	splitLlamaServerUrls,
} from "./discovery";
import { WorkingMessageDisplay } from "./progress";
import { createProgressStreamSimple } from "./stream";

export interface ProgressEntryDeps {
	/** Reads the project settings `llamaServerUrl` (default: pi's project settings). */
	projectUrl?: () => string | null;
	/** Reads the global settings `llamaServerUrl` (default: pi's global settings). */
	globalUrl?: () => string | null;
	/** Environment source (default: `process.env` for `LLAMA_SERVER_URL`). */
	env?: Record<string, string | undefined>;
}

function stringSetting(settings: unknown, key: string): string | null {
	if (!settings || typeof settings !== "object") return null;
	const value = (settings as Record<string, unknown>)[key];
	return typeof value === "string" && value.length > 0 ? value : null;
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

	const projectUrl =
		deps.projectUrl ?? (() => stringSetting(manager().getProjectSettings(), "llamaServerUrl"));
	const globalUrl =
		deps.globalUrl ?? (() => stringSetting(manager().getGlobalSettings(), "llamaServerUrl"));

	return (pi: ExtensionAPI) => {
		const urls = splitLlamaServerUrls(
			resolveJoinedLlamaServerUrl(
				projectUrl(),
				env.LLAMA_SERVER_URL ?? null,
				globalUrl(),
			),
		);

		// One shared display for all providers (multi-server: the slot reflects
		// whichever request is active).
		const display = new WorkingMessageDisplay();

		// Overlay the teed streamSimple on pi-llama-cpp's base provider config,
		// one provider per configured server.
		for (const url of urls) {
			pi.registerProvider(`llama-server=${url}`, {
				api: "openai-completions",
				streamSimple: createProgressStreamSimple(display),
			});
		}

		// Attach on events that carry the UI context, so the keyed slot is
		// live for the whole turn.
		pi.on("before_agent_start", (_event, ctx) => display.attach(ctx));
		pi.on("turn_start", (_event, ctx) => display.attach(ctx));
	};
}

export default (pi: ExtensionAPI) => {
	createProgressEntry()(pi);
};
