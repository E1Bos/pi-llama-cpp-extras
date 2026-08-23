import { describe, expect, it, vi } from "vitest";
import { PrefillProgressTracker, WorkingMessageDisplay } from "../src/progress";

const FILL = "█";
const EMPTY = "░";

function sseLine(payload: Record<string, unknown>): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

function progressEvent(total: number, processed: number, time_ms: number): string {
	return sseLine({ prompt_progress: { total, processed, time_ms } });
}

function feed(tracker: { feed(chunk: Uint8Array): void }, text: string): void {
	tracker.feed(new TextEncoder().encode(text));
}

/** Build the exact pi-llama-cpp-stats message: bar + space-padded pct + optional suffix. */
function expected(pct: number, filled: number, suffix?: string): string {
	const bar = `[${FILL.repeat(filled)}${EMPTY.repeat(20 - filled)}]`;
	const base = `Prefilling... ${bar} ${pct.toFixed(0).padStart(3)}%`;
	return suffix ? `${base} · ${suffix}` : base;
}

describe("PrefillProgressTracker", () => {
	it("emits nothing until a prompt_progress event arrives", () => {
		const onUpdate = vi.fn();
		const tracker = new PrefillProgressTracker(onUpdate);
		feed(tracker, sseLine({ choices: [{ delta: { content: "hi" } }] }));
		expect(onUpdate).not.toHaveBeenCalled();
	});

	it("renders the initial 0% event with an empty bar and no suffix", () => {
		const messages: (string | null)[] = [];
		const tracker = new PrefillProgressTracker((m) => messages.push(m));
		feed(tracker, progressEvent(1000, 0, 0));
		expect(messages).toEqual([expected(0, 0)]);
	});

	it("renders a mid-prefill bar with percentage, cumulative ETA and delta tok/s", () => {
		const messages: (string | null)[] = [];
		const tracker = new PrefillProgressTracker((m) => messages.push(m));
		feed(tracker, progressEvent(1000, 0, 0));
		feed(tracker, progressEvent(1000, 500, 500));
		// pct=50 -> 10 filled; eta=remaining/avg=500/1000=0.5s->"1s"; tps=500/500ms=1000.0
		expect(messages.at(-1)).toBe(expected(50, 10, "1s · 1000.0 tok/s"));
	});

	it("renders a partially filled bar for an arbitrary percentage", () => {
		const messages: (string | null)[] = [];
		const tracker = new PrefillProgressTracker((m) => messages.push(m));
		feed(tracker, progressEvent(1000, 400, 400));
		// pct=40 -> 8 filled; tps=400/400ms=1000.0; eta=600/1000=0.6s->"1s"
		expect(messages.at(-1)).toBe(expected(40, 8, "1s · 1000.0 tok/s"));
	});

	it("restores the default message (null) when processed reaches total", () => {
		const messages: (string | null)[] = [];
		const tracker = new PrefillProgressTracker((m) => messages.push(m));
		feed(tracker, progressEvent(1000, 500, 500));
		feed(tracker, progressEvent(1000, 1000, 1000));
		expect(messages.at(-1)).toBeNull();
	});

	it("falls back to a bare 'Prefilling...' when total is missing", () => {
		const messages: (string | null)[] = [];
		const tracker = new PrefillProgressTracker((m) => messages.push(m));
		feed(tracker, sseLine({ prompt_progress: { processed: 50, time_ms: 100 } }));
		expect(messages.at(-1)).toBe("Prefilling...");
	});

	it("reassembles a progress event split across chunk boundaries", () => {
		const messages: (string | null)[] = [];
		const tracker = new PrefillProgressTracker((m) => messages.push(m));
		const bytes = new TextEncoder().encode(progressEvent(1000, 250, 250));
		const half = Math.floor(bytes.length / 2);
		tracker.feed(bytes.slice(0, half));
		expect(messages).toEqual([]);
		tracker.feed(bytes.slice(half));
		expect(messages.at(-1)).toBe(expected(25, 5, "1s · 1000.0 tok/s"));
	});

	it("ignores non-JSON and non-progress data lines", () => {
		const onUpdate = vi.fn();
		const tracker = new PrefillProgressTracker(onUpdate);
		feed(tracker, "data: not-json\n\n");
		feed(tracker, "data: [DONE]\n\n");
		feed(tracker, sseLine({ choices: [] }));
		expect(onUpdate).not.toHaveBeenCalled();
	});

	it("restores the default message on finish even if prefill never completed", () => {
		const messages: (string | null)[] = [];
		const tracker = new PrefillProgressTracker((m) => messages.push(m));
		feed(tracker, progressEvent(1000, 500, 500));
		tracker.finish();
		expect(messages.at(-1)).toBeNull();
	});

	it("resets rate state so a retried request measures deltas from zero", () => {
		const messages: (string | null)[] = [];
		const tracker = new PrefillProgressTracker((m) => messages.push(m));
		feed(tracker, progressEvent(1000, 500, 500));
		tracker.reset();
		feed(tracker, progressEvent(1000, 250, 250));
		// After reset the delta is measured from 0, so tps = 250/250ms = 1000.0
		expect(messages.at(-1)).toBe(expected(25, 5, "1s · 1000.0 tok/s"));
	});

	it("predicts a shorter ETA than the cumulative average when the rate is rising", () => {
		const messages: (string | null)[] = [];
		const tracker = new PrefillProgressTracker((m) => messages.push(m));
		feed(tracker, progressEvent(10000, 0, 0));
		feed(tracker, progressEvent(10000, 2000, 2000)); // rate 1000 tok/s
		feed(tracker, progressEvent(10000, 4000, 3000)); // rate 2000 tok/s (rising)
		const msg = messages.at(-1)!;
		// Parse "Prefilling... <bar>  40% · <eta> · <tps>"
		const etaMatch = msg.match(/· (\d+m \d+s|\d+s) · /);
		expect(etaMatch).not.toBeNull();
		const tpsMatch = msg.match(/· (\d+\.\d+) tok\/s$/);
		expect(tpsMatch).not.toBeNull();
		// Live tok/s is the delta rate: (4000-2000)/(3000-2000ms) = 2000.0,
		// not the cumulative average (4000/3s = 1333.3).
		expect(tpsMatch![1]).toBe("2000.0");
		// Cumulative avg ETA = remaining / (processed/elapsed) = 6000 / (4000/3) = 4.5s.
		// A rising-rate fit must predict a shorter ETA than the cumulative average.
		const cumulativeEtaSec = 6000 / (4000 / 3);
		const fitEtaSec = parseDuration(etaMatch![1]);
		expect(fitEtaSec).toBeGreaterThan(0);
		expect(fitEtaSec).toBeLessThan(cumulativeEtaSec);
	});
});

function parseDuration(s: string): number {
	// "Ns" or "Mm Ss"
	const m = s.match(/^(\d+)m (\d+)s$/);
	if (m) return Number(m[1]) * 60 + Number(m[2]);
	const sec = s.match(/^(\d+(?:\.\d+)?)s$/);
	if (sec) return Number(sec[1]);
	throw new Error(`unparseable duration: ${s}`);
}

describe("WorkingMessageDisplay", () => {
	function makeCtx() {
		const setStatus = vi.fn();
		return { ctx: { ui: { setStatus }, hasUI: true }, setStatus };
	}

	it("is a no-op until attached", () => {
		const display = new WorkingMessageDisplay();
		display.set("Prefilling...");
		display.set(null);
		// No ctx attached, nothing to assert on; ensure it does not throw.
		expect(true).toBe(true);
	});

	it("writes the progress message to the keyed status slot and clears it on null", () => {
		const display = new WorkingMessageDisplay();
		const { ctx, setStatus } = makeCtx();
		display.attach(ctx);
		display.set("Prefilling... 050%");
		expect(setStatus).toHaveBeenLastCalledWith(WorkingMessageDisplay.SLOT_KEY, "Prefilling... 050%");
		display.set(null);
		expect(setStatus).toHaveBeenLastCalledWith(WorkingMessageDisplay.SLOT_KEY, undefined);
	});

	it("writes only to the keyed slot, never the shared working message", () => {
		const display = new WorkingMessageDisplay();
		const setStatus = vi.fn();
		const setWorkingMessage = vi.fn();
		// A ctx whose ui exposes both: the display must use only the keyed slot.
		const ui = { setStatus, setWorkingMessage };
		display.attach({ ui, hasUI: true });
		display.set("Prefilling...");
		display.set(null);
		expect(setStatus).toHaveBeenCalledTimes(2);
		expect(setWorkingMessage).not.toHaveBeenCalled();
	});

	it("dedupes identical messages", () => {
		const display = new WorkingMessageDisplay();
		const { ctx, setStatus } = makeCtx();
		display.attach(ctx);
		display.set("Prefilling... 050%");
		display.set("Prefilling... 050%");
		expect(setStatus).toHaveBeenCalledTimes(1);
	});

	it("does nothing when the UI is not available", () => {
		const display = new WorkingMessageDisplay();
		const setStatus = vi.fn();
		display.attach({ ui: { setStatus }, hasUI: false });
		display.set("Prefilling... 050%");
		expect(setStatus).not.toHaveBeenCalled();
	});

	it("ignores updates after finish() until the next start()", () => {
		const display = new WorkingMessageDisplay();
		const { ctx, setStatus } = makeCtx();
		display.attach(ctx);

		display.start();
		display.set("Prefilling...");
		display.finish();
		// Two writes: the message, then the clear from finish().
		expect(setStatus).toHaveBeenCalledTimes(2);
		expect(setStatus).toHaveBeenLastCalledWith(WorkingMessageDisplay.SLOT_KEY, undefined);

		// The display is settled: updates are ignored until start().
		display.set("Prefilling... 050%");
		expect(setStatus).toHaveBeenCalledTimes(2);

		display.start();
		display.set("Prefilling... 050%");
		expect(setStatus).toHaveBeenLastCalledWith(WorkingMessageDisplay.SLOT_KEY, "Prefilling... 050%");
	});
});
