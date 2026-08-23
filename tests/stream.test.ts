import { describe, it, expect, vi } from "vitest";
import type { Model, Context } from "@earendil-works/pi-ai";
import {
	createProgressFetch,
	createProgressStreamSimple,
	teeSse,
} from "../src/stream";
import { PrefillProgressTracker, WorkingMessageDisplay } from "../src/progress";

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

const SSE =
	chunk({}, { total: 1000, processed: 0, time_ms: 0 }) +
	chunk({}, { total: 1000, processed: 500, time_ms: 500 }) +
	chunk({ content: "Hello" }) +
	chunk({ content: " world" }) +
	chunk({}, undefined, "stop") +
	"data: [DONE]\n\n";

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

describe("teeSse", () => {
	it("passes every source chunk through unchanged and feeds each to the callback", async () => {
		const encoder = new TextEncoder();
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode("a"));
				controller.enqueue(encoder.encode("b"));
				controller.close();
			},
		});
		const seen: string[] = [];
		const passThrough = teeSse(source, (c) => seen.push(new TextDecoder().decode(c)));

		const received: string[] = [];
		const reader = passThrough.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			received.push(new TextDecoder().decode(value));
		}
		expect(received).toEqual(["a", "b"]);
		expect(seen).toEqual(["a", "b"]);
	});
});

describe("createProgressFetch", () => {
	it("tees the SSE body to the tracker while the response stays byte-identical", async () => {
		const baseFetch = vi.fn(async () => makeSseResponse(SSE));
		const tracker = new PrefillProgressTracker(() => {});
		const fetch = createProgressFetch((c) => tracker.feed(c), () => tracker.reset(), baseFetch);

		const response = await fetch("http://localhost:8080/v1/chat/completions", {});
		expect(baseFetch).toHaveBeenCalledTimes(1);

		// The pass-through body is the original SSE, byte for byte.
		const text = await response.text();
		expect(text).toBe(SSE);

		// The tracker observed the prefill progress carried in the chunks.
		// (prompt_progress is a non-standard field the OpenAI SDK passes through.)
		const rendered: (string | null)[] = [];
		const tracker2 = new PrefillProgressTracker((m) => rendered.push(m));
		const fetch2 = createProgressFetch((c) => tracker2.feed(c), () => tracker2.reset(), baseFetch);
		const response2 = await fetch2("http://localhost:8080/v1/chat/completions", {});
		await response2.text();
		expect(rendered.some((m) => m?.includes("50%"))).toBe(true);
	});

	it("runs onReset at the start of each fetch so a retry starts fresh", async () => {
		const baseFetch = vi.fn(async () => makeSseResponse(SSE));
		const onReset = vi.fn();
		const fetch = createProgressFetch(() => {}, onReset, baseFetch);

		await fetch("http://localhost:8080/v1/chat/completions", {});
		await fetch("http://localhost:8080/v1/chat/completions", {});
		expect(onReset).toHaveBeenCalledTimes(2);
	});
});

describe("createProgressStreamSimple", () => {
	it("streams the response, drives the working message from prefill progress, and clears it on completion", async () => {
		const baseFetch = vi.fn(async () => makeSseResponse(SSE));
		const display = new WorkingMessageDisplay();
		const workingMessages: Array<string | undefined> = [];
		display.attach({
			ui: { setWorkingMessage: (message) => workingMessages.push(message) },
			hasUI: true,
		});

		const streamSimple = createProgressStreamSimple(display, baseFetch);
		const stream = streamSimple(makeModel(), makeContext(), { apiKey: "sk-test" });

		const result = await stream.result();

		// The response content is assembled from the delta chunks.
		expect(result.content).toEqual([{ type: "text", text: "Hello world" }]);
		expect(result.stopReason).toBe("stop");
		expect(baseFetch).toHaveBeenCalledTimes(1);

		// The tracker saw the prefill progress and drove the working message line.
		const progressWrites = workingMessages.filter(
			(text) => typeof text === "string" && text.startsWith("Prefilling..."),
		);
		expect(progressWrites.length).toBe(2); // the 0% and 50% events
		// The line is cleared (undefined) once the stream settles, restoring
		// pi's default working message text.
		expect(workingMessages.at(-1)).toBeUndefined();
	});

	it("does not require a UI to be attached", async () => {
		const baseFetch = vi.fn(async () => makeSseResponse(SSE));
		const display = new WorkingMessageDisplay();
		const streamSimple = createProgressStreamSimple(display, baseFetch);
		const stream = streamSimple(makeModel(), makeContext(), { apiKey: "sk-test" });
		const result = await stream.result();
		expect(result.content).toEqual([{ type: "text", text: "Hello world" }]);
	});

	it("shows the thinking counter after prefill and clears it when the answer starts", async () => {
		const sse =
			chunk({}, { total: 1000, processed: 0, time_ms: 0 }) +
			chunk({}, { total: 1000, processed: 1000, time_ms: 1000 }) +
			chunk({ reasoning_content: "a".repeat(4000) }) +
			chunk({ content: "Hello" }) +
			chunk({ content: " world" }) +
			chunk({}, undefined, "stop") +
			"data: [DONE]\n\n";
		const baseFetch = vi.fn(async () => makeSseResponse(sse));
		const display = new WorkingMessageDisplay();
		const workingMessages: Array<string | undefined> = [];
		display.attach({
			ui: { setWorkingMessage: (message) => workingMessages.push(message) },
			hasUI: true,
		});

		const streamSimple = createProgressStreamSimple(display, baseFetch);
		const stream = streamSimple(makeModel(), makeContext(), { apiKey: "sk-test" });
		const result = await stream.result();

		// The response content carries both the thinking block and the answer.
		expect(result.content.some((b) => b.type === "text" && b.text === "Hello world")).toBe(true);
		expect(result.content.some((b) => b.type === "thinking")).toBe(true);

		// The working message line is phase-exclusive: the prefill bar shows
		// first, then the thinking counter, and the line is cleared (undefined)
		// once the stream settles.
		const prefillIdx = workingMessages.findIndex(
			(m) => typeof m === "string" && m.startsWith("Prefilling..."),
		);
		const thinkingIdx = workingMessages.findIndex(
			(m) => typeof m === "string" && m.startsWith("Working..."),
		);
		expect(prefillIdx).toBeGreaterThanOrEqual(0);
		expect(thinkingIdx).toBeGreaterThan(prefillIdx);
		expect(workingMessages.at(-1)).toBeUndefined();
	});

	it("clears the working message when the request is aborted", async () => {
		const baseFetch = vi.fn(async () => makeSseResponse(SSE));
		const display = new WorkingMessageDisplay();
		const workingMessages: Array<string | undefined> = [];
		display.attach({
			ui: { setWorkingMessage: (message) => workingMessages.push(message) },
			hasUI: true,
		});

		const controller = new AbortController();
		const streamSimple = createProgressStreamSimple(display, baseFetch);
		const stream = streamSimple(makeModel(), makeContext(), {
			apiKey: "sk-test",
			signal: controller.signal,
		});
		controller.abort(); // the fake fetch ignores the signal; pi-ai aborts after consuming it

		const result = await stream.result();
		expect(result.stopReason).toBe("aborted");
		// The stream settles via the error event, so the line is cleared.
		expect(workingMessages.at(-1)).toBeUndefined();
	});
});
