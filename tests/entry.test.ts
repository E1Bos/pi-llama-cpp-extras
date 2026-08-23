import { describe, expect, it, vi } from "vitest";
import type {
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import entry, { createProgressEntry } from "../src/index";
import { WorkingMessageDisplay } from "../src/progress";

// --- fakes -----------------------------------------------------------------

type StatusCtx = {
	ui: { setStatus: (key: string, text: string | undefined) => void };
	hasUI: boolean;
};
type EventHandler = (event: unknown, ctx: StatusCtx) => void;

function makeFakePi() {
	const registrations: Array<{ id: string; config: Record<string, unknown> }> = [];
	const handlers = new Map<string, EventHandler>();
	const pi = {
		registerProvider: (id: string, config: Record<string, unknown>) => {
			registrations.push({ id, config });
		},
		on: (event: string, handler: EventHandler) => {
			handlers.set(event, handler);
		},
	};
	return { pi: pi as unknown as ExtensionAPI, registrations, handlers };
}

function makeSseResponse(sseText: string): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(sseText));
			controller.close();
		},
	});
	return new Response(body, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

/**
 * Build an SSE chunk. `prompt_progress` is a top-level field (llama.cpp emits
 * it at the chunk root, not inside `choices`), matching pi-llama-cpp-stats.
 */
function chunk(
	delta: Record<string, unknown>,
	promptProgress?: Record<string, unknown>,
	finishReason: string | null = null,
): string {
	const body: Record<string, unknown> = {
		id: "c1",
		object: "chat.completion.chunk",
		created: 1,
		model: "test-model",
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	};
	if (promptProgress) body.prompt_progress = promptProgress;
	return `data: ${JSON.stringify(body)}\n\n`;
}

function makeModel(): Model<"openai-completions"> {
	return {
		id: "test-model",
		name: "Test Model",
		api: "openai-completions",
		provider: "test",
		baseUrl: "http://localhost:8080/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 4096,
		maxTokens: 1024,
	} as unknown as Model<"openai-completions">;
}

function makeContext(): Context {
	return {
		systemPrompt: "",
		messages: [{ role: "user", content: "hi" }],
	} as unknown as Context;
}

// --- tests -------------------------------------------------------------------

describe("extension entry", () => {
	it("default-exports a factory function", () => {
		expect(typeof entry).toBe("function");
	});

	it("registers a streamSimple overlay on each llama-server=<url> provider", () => {
		const { pi, registrations } = makeFakePi();
		createProgressEntry({
			projectUrl: () => null,
			globalUrl: () => "http://global:8080; http://global:8081",
			env: {},
		})(pi);

		// One provider per URL in the cascade, pi-llama-cpp's providerId format.
		expect(registrations.map((r) => r.id)).toEqual([
			"llama-server=http://global:8080",
			"llama-server=http://global:8081",
		]);
		for (const r of registrations) {
			// Only the overlay keys: the merge keeps pi-llama-cpp's base config.
			expect(Object.keys(r.config).sort()).toEqual(["api", "streamSimple"]);
			expect(r.config.api).toBe("openai-completions");
			expect(typeof r.config.streamSimple).toBe("function");
		}
	});

	it("attaches the display on before_agent_start and turn_start so the slot is live for the turn", async () => {
		const sse =
			chunk({}, { total: 100, processed: 0, time_ms: 0 }) +
			chunk({ content: "hi" }) +
			chunk({}, undefined, "stop") +
			"data: [DONE]\n\n";
		// The entry's streamSimple tees through `globalThis.fetch` (the
		// `createProgressStreamSimple` default), so stub it before the entry
		// runs; the teed wrapper still drives the display.
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => makeSseResponse(sse));

		const { pi, registrations, handlers } = makeFakePi();
		createProgressEntry({
			projectUrl: () => null,
			globalUrl: () => null,
			env: {},
		})(pi);

		const statuses: Array<[string, string | undefined]> = [];
		const ctx: StatusCtx = {
			ui: { setStatus: (key, text) => statuses.push([key, text]) },
			hasUI: true,
		};

		// Both events attach the display (acceptance 4).
		handlers.get("before_agent_start")!({}, ctx);
		handlers.get("turn_start")!({}, ctx);

		// A request on the default-server provider tees progress into the
		// attached slot.
		const streamSimple = registrations[0].config
			.streamSimple as (
			model: Model<"openai-completions">,
			context: Context,
			options?: SimpleStreamOptions,
		) => AssistantMessageEventStream;
		const stream = streamSimple(makeModel(), makeContext(), { apiKey: "sk-test" });
		const result = await stream.result();
		expect(result.stopReason).toBe("stop");
		fetchSpy.mockRestore();

		const slotWrites = statuses.filter(
			([key]) => key === WorkingMessageDisplay.SLOT_KEY,
		);
		expect(
			slotWrites.some(([, text]) => typeof text === "string" && text.startsWith("Prefilling...")),
		).toBe(true);
		// The slot is cleared once the stream settles.
		expect(statuses.at(-1)).toEqual([WorkingMessageDisplay.SLOT_KEY, undefined]);
	});

	it("runs the default entry against a capturing pi without throwing", () => {
		const { pi, registrations, handlers } = makeFakePi();
		entry(pi);
		// Whatever the machine's settings are, the cascade resolves to at
		// least the default server.
		expect(registrations.length).toBeGreaterThanOrEqual(1);
		for (const r of registrations) expect(r.id.startsWith("llama-server=")).toBe(true);
		expect(handlers.has("before_agent_start")).toBe(true);
		expect(handlers.has("turn_start")).toBe(true);
	});
});
