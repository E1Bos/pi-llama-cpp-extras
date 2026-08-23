import { streamSimple as openaiCompletionsStreamSimple } from "@earendil-works/pi-ai/compat";
import type {
	Api,
	Model,
	Context,
	AssistantMessageEventStream,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { PrefillProgressTracker, WorkingMessageDisplay } from "./progress";

/**
 * Tee an SSE ReadableStream: every chunk is passed through unchanged (so the
 * OpenAI SDK sees the original byte stream) and also fed to `onChunk`.
 *
 * The pass-through is lossless — the source reader's chunks are enqueued
 * verbatim, and `onChunk` runs before the enqueue so the tracker observes the
 * same bytes the SDK parses.
 */
export function teeSse(
	source: ReadableStream<Uint8Array>,
	onChunk: (chunk: Uint8Array) => void,
): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			const reader = source.getReader();
			const pump = async () => {
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						if (value) onChunk(value);
						controller.enqueue(value);
					}
					controller.close();
				} catch (err) {
					controller.error(err);
				}
			};
			void pump();
		},
	});
}

/**
 * Wrap a fetch function so that SSE response bodies are teed to progress
 * trackers. The wrapped fetch behaves identically to `baseFetch` for the
 * caller (same Response, same body bytes) — it only adds the side channel.
 *
 * Non-SSE responses (errors, non-streaming) pass through untouched.
 *
 * `onReset` runs at the start of every fetch so a retried request measures
 * rate deltas from a clean slate.
 */
export function createProgressFetch(
	onChunk: (chunk: Uint8Array) => void,
	onReset: () => void,
	baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
	return async (input, init) => {
		onReset();
		const response = await baseFetch(input, init);
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.includes("text/event-stream") || !response.body) {
			return response;
		}
		return new Response(teeSse(response.body, onChunk), {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	};
}

/**
 * Build a `streamSimple` handler that tees the SSE body to the given display.
 *
 * Each call creates fresh trackers (state is per-request, so concurrent
 * requests don't interfere) and wires them to the shared display. The
 * built-in OpenAI-completions streamSimple still assembles the response from
 * the same teed stream, so the model output is unaffected.
 *
 * The handler is typed against the wide `Model<Api>` (matching
 * `ProviderConfig.streamSimple`); the downcast to
 * `Model<"openai-completions">` is safe because the provider is registered
 * with `api: "openai-completions"` (ticket 04).
 *
 * `stream.result()` resolves on the stream's terminal event (done, error, or
 * the error event pushed on abort), so the slot is cleared on completion,
 * error, and abort alike.
 *
 * Ticket 03 (thinking progress) adds a `ThinkingProgressTracker` fed from the
 * same `onChunk`/`onReset` callbacks; ticket 02 feeds only the prefill
 * tracker.
 */
export function createProgressStreamSimple(
	display: WorkingMessageDisplay,
	baseFetch: typeof globalThis.fetch = globalThis.fetch,
): (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream {
	return (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
		const prefill = new PrefillProgressTracker((message) => display.set(message));
		const fetch = createProgressFetch(
			(chunk) => {
				prefill.feed(chunk);
			},
			() => {
				prefill.reset();
			},
			baseFetch,
		);
		display.start();
		const stream = openaiCompletionsStreamSimple(
			model as Model<"openai-completions">,
			context,
			{ ...options, fetch },
		);
		void stream.result().then(() => {
			prefill.finish();
			display.finish();
		});
		return stream;
	};
}

