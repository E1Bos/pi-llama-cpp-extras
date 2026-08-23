import { describe, expect, it } from "vitest";
import {
	DEFAULT_LLAMA_SERVER_URL,
	resolveJoinedLlamaServerUrl,
	splitLlamaServerUrls,
} from "../src/discovery";

describe("resolveJoinedLlamaServerUrl", () => {
	it("defaults to the standard local server when nothing is configured", () => {
		expect(resolveJoinedLlamaServerUrl(null, null, null)).toBe("http://127.0.0.1:8080");
		expect(DEFAULT_LLAMA_SERVER_URL).toBe("http://127.0.0.1:8080");
	});

	it("prefers the project settings over env and global", () => {
		expect(
			resolveJoinedLlamaServerUrl("http://project:8080", "http://env:8080", "http://global:8080"),
		).toBe("http://project:8080");
	});

	it("falls back to the env var when the project setting is unset", () => {
		expect(
			resolveJoinedLlamaServerUrl(null, "http://env:8080", "http://global:8080"),
		).toBe("http://env:8080");
	});

	it("falls back to the global setting when project and env are unset", () => {
		expect(resolveJoinedLlamaServerUrl(null, null, "http://global:8080")).toBe(
			"http://global:8080",
		);
	});

	it("treats empty strings as unset", () => {
		expect(
			resolveJoinedLlamaServerUrl("", "http://env:8080", ""),
		).toBe("http://env:8080");
	});
});

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
