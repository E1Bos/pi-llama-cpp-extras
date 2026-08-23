/**
 * Reconstructs the llama-server URL cascade the same way pi-llama-cpp's
 * `ConfigResolver` does, so the `llama-server=<url>` providerIds this package
 * registers match the ones pi-llama-cpp creates byte-for-byte.
 *
 * This is the one piece of logic this package deliberately duplicates from
 * pi-llama-cpp: querying Pi's model registry would only see the user's
 * *selection*, not the full provider registry, so reconstruction is the
 * deterministic discovery surface.
 */

/** pi-llama-cpp's default server (its `DEFAULT_LLAMA_SERVER_URL`). */
export const DEFAULT_LLAMA_SERVER_URL = "http://127.0.0.1:8080";

/**
 * Resolves the joined llama-server URL string from the cascade, mirroring
 * pi-llama-cpp's `extractJoinedUrls()`:
 *
 * 1. project `.pi/settings.json` `llamaServerUrl`
 * 2. `LLAMA_SERVER_URL` environment variable
 * 3. global settings `llamaServerUrl`
 * 4. the default local server
 *
 * The first source with a non-empty value wins; sources are not merged.
 * Empty strings are treated as unset, same as pi-llama-cpp.
 */
export function resolveJoinedLlamaServerUrl(
	project: string | null | undefined,
	env: string | null | undefined,
	global: string | null | undefined,
): string {
	if (project) return project;
	if (env) return env;
	if (global) return global;
	return DEFAULT_LLAMA_SERVER_URL;
}

/**
 * Splits a joined URL string on `;`, mirroring pi-llama-cpp's
 * `resolveUrls()`: trims each entry, drops empty ones, and strips trailing
 * slashes. The trailing-slash stripping is load-bearing: pi-llama-cpp builds
 * its providerIds from the processed URLs, so this package must process
 * identically for the providerIds to line up.
 */
export function splitLlamaServerUrls(joined: string): string[] {
	return joined
		.split(";")
		.map((url) => url.trim())
		.filter((url) => url.length > 0)
		.map((url) => url.replace(/\/+$/, ""));
}
