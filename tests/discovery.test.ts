import { describe, expect, it } from "vitest";
import {
	DEFAULT_LLAMA_SERVER_URL,
	splitLlamaServerUrls,
	resolveLlamaServers,
	type DiscoverySources,
} from "../src/discovery";

describe("splitLlamaServerUrls", () => {
	it("passes a single URL through", () => {
		expect(splitLlamaServerUrls("http://127.0.0.1:8080")).toEqual(["http://127.0.0.1:8080"]);
	});

	it("splits on semicolons and trims whitespace", () => {
		expect(splitLlamaServerUrls("http://a:8080; http://b:8081")).toEqual([
			"http://a:8080",
			"http://b:8081",
		]);
	});

	it("drops empty entries", () => {
		expect(splitLlamaServerUrls("http://a:8080;;http://b:8081;")).toEqual([
			"http://a:8080",
			"http://b:8081",
		]);
	});

	it("strips trailing slashes so providerIds match pi-llama-cpp byte-for-byte", () => {
		expect(splitLlamaServerUrls("http://a:8080///;http://b:8081/")).toEqual([
			"http://a:8080",
			"http://b:8081",
		]);
	});

	it("keeps non-trailing path segments", () => {
		expect(splitLlamaServerUrls("http://a:8080/v1")).toEqual(["http://a:8080/v1"]);
	});
});

const EMPTY: DiscoverySources = { project: null, global: null, env: {} };

describe("resolveLlamaServers", () => {
	it("defaults to the standard local server with the prefixed providerId", () => {
		expect(resolveLlamaServers(EMPTY)).toEqual([
			{ url: "http://127.0.0.1:8080", providerId: "llama-server=http://127.0.0.1:8080" },
		]);
		expect(DEFAULT_LLAMA_SERVER_URL).toBe("http://127.0.0.1:8080");
	});

	it("uses llamaSettings.servers (new layout) with prefixed ids when no env is set", () => {
		const sources: DiscoverySources = {
			...EMPTY,
			global: {
				llamaSettings: {
					servers: [
						{ url: "http://127.0.0.1:8080", name: "Local Server" },
						{ url: "http://10.0.0.5:8080", name: "Remote Server" },
					],
				},
			},
		};
		expect(resolveLlamaServers(sources)).toEqual([
			{ url: "http://127.0.0.1:8080", providerId: "llama-server=http://127.0.0.1:8080" },
			{ url: "http://10.0.0.5:8080", providerId: "llama-server=http://10.0.0.5:8080" },
		]);
	});

	it("applies the server id override as the providerId", () => {
		const sources: DiscoverySources = {
			...EMPTY,
			global: {
				llamaSettings: {
					servers: [
						{ url: "http://127.0.0.1:8080", id: "local", name: "Local Server" },
						{ url: "http://10.0.0.5:8080" },
					],
				},
			},
		};
		expect(resolveLlamaServers(sources)).toEqual([
			{ url: "http://127.0.0.1:8080", providerId: "local" },
			{ url: "http://10.0.0.5:8080", providerId: "llama-server=http://10.0.0.5:8080" },
		]);
	});

	it("prefers the env variable over all settings sources", () => {
		const sources: DiscoverySources = {
			...EMPTY,
			env: { LLAMA_SERVER_URL: "http://env:8080;http://env:8081/" },
			global: {
				llamaSettings: { servers: [{ url: "http://settings:8080", id: "settings" }] },
				llamaServerUrl: "http://legacy:8080",
			},
		};
		expect(resolveLlamaServers(sources)).toEqual([
			{ url: "http://env:8080", providerId: "llama-server=http://env:8080" },
			{ url: "http://env:8081", providerId: "llama-server=http://env:8081" },
		]);
	});

	it("falls back to the legacy llamaServerUrl key when servers is unset", () => {
		const sources: DiscoverySources = {
			...EMPTY,
			global: { llamaServerUrl: "http://a:8080; http://b:8081/" },
		};
		expect(resolveLlamaServers(sources)).toEqual([
			{ url: "http://a:8080", providerId: "llama-server=http://a:8080" },
			{ url: "http://b:8081", providerId: "llama-server=http://b:8081" },
		]);
	});

	it("splits each server entry's url on semicolons", () => {
		const sources: DiscoverySources = {
			...EMPTY,
			global: { llamaSettings: { servers: [{ url: "http://a:8080;http://b:8081" }] } },
		};
		expect(resolveLlamaServers(sources).map((s) => s.url)).toEqual([
			"http://a:8080",
			"http://b:8081",
		]);
	});

	it("lets the project llamaSettings wholly replace the global one (shallow merge)", () => {
		const sources: DiscoverySources = {
			...EMPTY,
			project: {
				llamaSettings: { servers: [{ url: "http://project:8080", id: "p" }] },
			},
			global: {
				llamaSettings: { servers: [{ url: "http://global:8080", id: "g" }] },
				llamaServerUrl: "http://legacy:8080",
			},
		};
		expect(resolveLlamaServers(sources)).toEqual([
			{ url: "http://project:8080", providerId: "p" },
		]);
	});

	it("matches env urls against settings servers so an id can apply", () => {
		const sources: DiscoverySources = {
			...EMPTY,
			env: { LLAMA_SERVER_URL: "http://127.0.0.1:8080" },
			global: {
				llamaSettings: { servers: [{ url: "http://127.0.0.1:8080", id: "local" }] },
			},
		};
		expect(resolveLlamaServers(sources)).toEqual([
			{ url: "http://127.0.0.1:8080", providerId: "local" },
		]);
	});

	it("treats empty-string sources as unset", () => {
		const sources: DiscoverySources = {
			...EMPTY,
			env: { LLAMA_SERVER_URL: "" },
			global: { llamaSettings: { servers: [] }, llamaServerUrl: "" },
		};
		expect(resolveLlamaServers(sources)).toEqual([
			{ url: "http://127.0.0.1:8080", providerId: "llama-server=http://127.0.0.1:8080" },
		]);
	});

	it("treats malformed llamaSettings/servers/urls as unset", () => {
		const sources: DiscoverySources = {
			...EMPTY,
			project: { llamaSettings: "not-an-object" },
			global: {
				llamaSettings: { servers: [{ id: "x" }, { url: 42 }, "junk"] },
				llamaServerUrl: 123,
			},
		};
		expect(resolveLlamaServers(sources)).toEqual([
			{ url: "http://127.0.0.1:8080", providerId: "llama-server=http://127.0.0.1:8080" },
		]);
	});

	it("strips trailing slashes before matching env urls against server ids", () => {
		const sources: DiscoverySources = {
			...EMPTY,
			env: { LLAMA_SERVER_URL: "http://a:8080/" },
			global: { llamaSettings: { servers: [{ url: "http://a:8080", id: "a" }] } },
		};
		expect(resolveLlamaServers(sources)).toEqual([
			{ url: "http://a:8080", providerId: "a" },
		]);
	});
});
