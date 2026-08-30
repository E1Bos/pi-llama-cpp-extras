/**
 * Reconstructs the llama.cpp servers and their providerIds the same way
 * pi-llama-cpp `0.10.0`'s `LlamaSettingsManager` does, so the providerIds
 * this package overlays match the ones pi-llama-cpp creates byte-for-byte.
 *
 * This is the one piece of logic this package deliberately duplicates from
 * pi-llama-cpp: querying Pi's model registry would only see the user's
 * *selection*, not the full provider registry, so reconstruction is the
 * deterministic discovery surface.
 *
 * pi-llama-cpp `0.10.0` registers one provider per server under
 * `server.id` when configured (e.g. `"local"`) and `llama-server=<url>`
 * otherwise, resolving server URLs in this order (first non-empty wins,
 * sources are not merged):
 *
 * 1. `LLAMA_SERVER_URL` environment variable
 * 2. `llamaSettings.servers[].url`
 * 3. top-level `llamaServerUrl` (legacy)
 * 4. the default local server
 *
 * Settings are shallow-merged project-over-global (`{...global, ...project}`),
 * so a project `llamaSettings` key wholly replaces the global one.
 */

/** pi-llama-cpp's default server (its `LLAMA_SERVER_URL` constant). */
export const DEFAULT_LLAMA_SERVER_URL = "http://127.0.0.1:8080";

/** pi-llama-cpp's providerId prefix (its `PROVIDER_PREFIX` constant). */
export const PROVIDER_PREFIX = "llama-server";

/** A server this package will overlay, with the providerId pi-llama-cpp uses. */
export interface ResolvedLlamaServer {
	/** The processed server URL (no trailing slash). */
	url: string;
	/** The providerId pi-llama-cpp registers for this URL. */
	providerId: string;
}

/**
 * The settings sources, mirroring pi-llama-cpp's merged view of its
 * `SettingsManager` plus the environment.
 */
export interface DiscoverySources {
	/** Project settings (`.pi/settings.json`), or `null` if absent. */
	project?: Record<string, unknown> | null;
	/** Global settings, or `null` if absent. */
	global?: Record<string, unknown> | null;
	/** Environment source (default: `process.env` for `LLAMA_SERVER_URL`). */
	env?: Record<string, string | undefined>;
}

/** A `llamaSettings.servers[]` entry as it may appear in settings JSON. */
interface LlamaServerConfig {
	url?: unknown;
	id?: unknown;
}

/**
 * Splits a raw URL string into processed URLs, mirroring pi-llama-cpp's
 * `parseUrls()`: trims each entry, drops empty ones, and strips trailing
 * slashes. The trailing-slash stripping is load-bearing: pi-llama-cpp builds
 * its providerIds (and its `id` lookups) from the processed URLs, so this
 * package must process identically for the providerIds to line up.
 */
export function splitLlamaServerUrls(raw: string): string[] {
	return raw
		.split(";")
		.map((url) => url.trim())
		.filter((url) => url.length > 0)
		.map((url) => url.replace(/\/+$/, ""));
}

/**
 * Resolves the llama.cpp servers and their providerIds from the sources,
 * mirroring pi-llama-cpp `0.10.0`'s `resolveServers()`.
 */
export function resolveLlamaServers(sources: DiscoverySources = {}): ResolvedLlamaServer[] {
	const { project = null, global = null, env = {} } = sources;

	// Same shallow merge as pi-llama-cpp's `mergedSettings`.
	const merged: Record<string, unknown> = { ...global, ...project };
	const serverConfigs = extractServerConfigs(merged);

	const urls =
		resolveEnvUrls(env) ??
		resolveServerUrls(serverConfigs) ??
		resolveLegacyUrls(merged) ??
		[DEFAULT_LLAMA_SERVER_URL];

	return urls
		.map((url) => {
			// pi-llama-cpp applies `id` from the merged `llamaSettings.servers`
			// entry whose processed URL matches, whatever the URL's source.
			const config = serverConfigs.find((s) => s.url === url);
			return {
				url,
				providerId: typeof config?.id === "string" ? config.id : `${PROVIDER_PREFIX}=${url}`,
			};
		})
		.filter((s, i, all) => all.findIndex((o) => o.providerId === s.providerId) === i);
}

function resolveEnvUrls(env: Record<string, string | undefined>): string[] | null {
	const raw = env.LLAMA_SERVER_URL;
	if (!raw) return null;
	const urls = splitLlamaServerUrls(raw);
	return urls.length > 0 ? urls : null;
}

function resolveServerUrls(serverConfigs: LlamaServerConfig[]): string[] | null {
	if (serverConfigs.length === 0) return null;
	const urls = serverConfigs.flatMap((s) =>
		typeof s.url === "string" ? splitLlamaServerUrls(s.url) : [],
	);
	return urls.length > 0 ? urls : null;
}

function resolveLegacyUrls(merged: Record<string, unknown>): string[] | null {
	const raw = merged.llamaServerUrl;
	if (typeof raw !== "string" || raw.length === 0) return null;
	const urls = splitLlamaServerUrls(raw);
	return urls.length > 0 ? urls : null;
}

function extractServerConfigs(merged: Record<string, unknown>): LlamaServerConfig[] {
	const llama = merged.llamaSettings;
	if (!llama || typeof llama !== "object") return [];
	const servers = (llama as Record<string, unknown>).servers;
	if (!Array.isArray(servers)) return [];
	return servers.filter(
		(s): s is LlamaServerConfig => s !== null && typeof s === "object" && typeof s.url === "string",
	);
}
