/**
 * Prefill progress tracking for the progress display.
 *
 * Lifted from the pi-llama-cpp fork (commit 67f09e4), mirroring
 * pi-llama-cpp-stats' prefill progress: a 20-character bar, a space-padded
 * percentage, an ETA (rate-curve fit, falling back to the cumulative
 * average), and a live tok/s. The tracker is pure: it parses raw SSE and
 * reports rendered messages through a callback, so it can be tested without
 * a UI. `null` means "restore the default message".
 */

export interface PromptProgress {
	total?: number;
	processed?: number;
	time_ms?: number;
	cache?: number;
}

const BAR_WIDTH = 20;
const RATE_WINDOW = 20;

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const m = Math.floor(seconds / 60);
	const s = Math.round(seconds % 60);
	return `${m}m ${s}s`;
}

/**
 * Human-readable token count: `850`, `1k`, `1.2k`.
 * Used by the thinking tracker (ticket 03); lifted alongside `formatDuration`
 * so the shared helpers live with the trackers that use them.
 */
export function formatTokenCount(n: number): string {
	if (n < 1000) return String(n);
	const k = n / 1000;
	const s = k.toFixed(1);
	return s.endsWith(".0") ? `${Math.round(k)}k` : `${s}k`;
}

/**
 * Tracks `prompt_progress` events from a raw SSE stream and renders the
 * progress message. Feed raw bytes (lines may be split across chunks); the
 * tracker buffers partial lines and parses `data:` payloads.
 */
export class PrefillProgressTracker {
	private buffer = "";
	private current: PromptProgress | null = null;
	private hasReceivedPrefill = false;
	private prevProcessed = 0;
	private prevTimeMs = 0;
	private lastDelta: { processed: number; timeMs: number } | null = null;
	private rateHistory: Array<{ processed: number; tps: number }> = [];
	private onUpdate: (message: string | null) => void;

	constructor(onUpdate: (message: string | null) => void) {
		this.onUpdate = onUpdate;
	}

	/** Reset state for a new request attempt (e.g. after a retry). */
	reset(): void {
		this.buffer = "";
		this.current = null;
		this.hasReceivedPrefill = false;
		this.prevProcessed = 0;
		this.prevTimeMs = 0;
		this.lastDelta = null;
		this.rateHistory = [];
	}

	/** Feed raw SSE bytes; `data:` lines may be split across chunks. */
	feed(chunk: Uint8Array): void {
		this.buffer += new TextDecoder().decode(chunk);
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";
		for (const line of lines) {
			this.processLine(line);
		}
	}

	/** Call when the stream settles (done or error) to restore the default message. */
	finish(): void {
		this.onUpdate(null);
	}

	private processLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) return;
		const data = trimmed.slice("data:".length).trim();
		if (!data || data === "[DONE]") return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			return;
		}
		const progress = (parsed as { prompt_progress?: PromptProgress })?.prompt_progress;
		if (progress && typeof progress === "object") {
			this.observe(progress);
		}
	}

	private observe(progress: PromptProgress): void {
		this.hasReceivedPrefill = true;
		const processed = progress.processed;
		const timeMs = progress.time_ms;
		if (typeof processed === "number" && typeof timeMs === "number") {
			// Capture the delta before advancing prev, so the live tok/s reflects
			// the most recent interval rather than the cumulative average.
			this.lastDelta = {
				processed: processed - this.prevProcessed,
				timeMs: timeMs - this.prevTimeMs,
			};
			const deltaProcessed = this.lastDelta.processed;
			const deltaTimeMs = this.lastDelta.timeMs;
			if (deltaTimeMs > 0 && deltaProcessed > 0) {
				this.rateHistory.push({
					processed,
					tps: (deltaProcessed / deltaTimeMs) * 1000,
				});
				if (this.rateHistory.length > RATE_WINDOW) this.rateHistory.shift();
			}
			this.prevProcessed = processed;
			this.prevTimeMs = timeMs;
		}
		this.current = progress;
		this.onUpdate(this.render());
	}

	private render(): string | null {
		if (!this.hasReceivedPrefill) return null;
		const p = this.current;
		if (!p) return null;
		// Prefill complete: restore the default message.
		if (p.total && p.processed === p.total) return null;
		if (!p.total || p.processed === undefined) return "Prefilling...";

		const pct = (p.processed / p.total) * 100;
		const filled = Math.round((pct / 100) * BAR_WIDTH);
		const bar = `[${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}]`;

		let suffix = "";
		const processed = p.processed;
		const total = p.total;
		const timeMs = p.time_ms;
		if (timeMs && processed > 0) {
			const elapsedSec = timeMs / 1000;
			const avgRate = processed / elapsedSec;
			const remaining = total - processed;
			let etaSec = remaining / avgRate;

			const delta = this.lastDelta;
			const tps =
				delta && delta.timeMs > 0 && delta.processed > 0
					? ((delta.processed / delta.timeMs) * 1000).toFixed(1)
					: ((processed / timeMs) * 1000).toFixed(1);

			const predictedEta = this.estimateEtaSec(processed, total);
			if (predictedEta > 0) etaSec = predictedEta;
			suffix = `${formatDuration(etaSec)} · ${tps} tok/s`;
		}

		return `Prefilling... ${bar} ${pct.toFixed(0).padStart(3)}%${suffix ? ` · ${suffix}` : ""}`;
	}

	/**
	 * Predict the ETA by linearly fitting the rate curve (tokens/sec vs.
	 * processed tokens) over the recent deltas and integrating the remaining
	 * tokens under the fitted rate (closed-form logarithmic integral).
	 * Returns 0 when there are not enough rate points, the fit is essentially
	 * flat, or the fit predicts a non-positive rate, so the caller keeps the
	 * cumulative-average estimate.
	 */
	private estimateEtaSec(processed: number, total: number): number {
		const remaining = total - processed;
		if (remaining <= 0) return 0;
		const fit = this.fitRateCurve();
		if (!fit) return 0;
		const { slope, intercept } = fit;
		if (Math.abs(slope) < 0.001) {
			const avgTps = this.rateHistory.reduce((s, p) => s + p.tps, 0) / this.rateHistory.length;
			return avgTps > 0 ? remaining / avgTps : 0;
		}
		// TPS(x) = slope * x + intercept
		// dt/dx = 1 / (slope * x + intercept)
		// t = ∫ dx / (slope * x + intercept) from processed to total
		//   = (1/slope) * ln((slope*total + intercept) / (slope*processed + intercept))
		const a = slope * total + intercept;
		const b = slope * processed + intercept;
		if (a <= 0 || b <= 0) {
			const avgTps = this.rateHistory.reduce((s, p) => s + p.tps, 0) / this.rateHistory.length;
			return avgTps > 0 ? remaining / avgTps : 0;
		}
		const ratio = a / b;
		if (ratio <= 0) return 0;
		return Math.log(ratio) / slope;
	}

	/**
	 * Linear fit of tokens/sec vs. processed tokens over the recent deltas.
	 * Returns null when there are fewer than two points or the x-values are
	 * all identical (degenerate fit).
	 */
	private fitRateCurve(): { slope: number; intercept: number } | null {
		const n = this.rateHistory.length;
		if (n < 2) return null;
		let sumX = 0;
		let sumY = 0;
		let sumXY = 0;
		let sumX2 = 0;
		for (const pt of this.rateHistory) {
			sumX += pt.processed;
			sumY += pt.tps;
			sumXY += pt.processed * pt.tps;
			sumX2 += pt.processed * pt.processed;
		}
		const denom = n * sumX2 - sumX * sumX;
		if (denom === 0) return null;
		const slope = (n * sumXY - sumX * sumY) / denom;
		const intercept = (sumY - slope * sumX) / n;
		return { slope, intercept };
	}
}

/**
 * Bridge from the provider stream to a keyed UI slot (`ui.setStatus`),
 * keeping progress text off the shared working message so it never fights
 * other extensions or pi's own loading text. The name is retained from the
 * fork for seam continuity, but the target is the keyed slot, not
 * `setWorkingMessage`.
 *
 * The provider stream has no `ExtensionContext`, so the extension attaches
 * the UI on events that carry `ctx` (see the extension entry). Identical
 * messages are deduped so decode tokens don't trigger redundant renders.
 */
export class WorkingMessageDisplay {
	/**
	 * Keyed status slot for progress, namespaced so it doesn't collide with
	 * other extensions. Shared across the progress phases (ticket 03's
	 * thinking counter reuses it); the phases never overlap, so a single
	 * slot is enough.
	 */
	static readonly SLOT_KEY = "pi-llama-cpp-extras:progress";

	private ui: { setStatus(key: string, text: string | undefined): void } | null = null;
	private active = false;
	private finished = false;
	private lastShown: string | null | undefined;

	attach(ctx: { ui: { setStatus(key: string, text: string | undefined): void }; hasUI: boolean }): void {
		this.ui = ctx.ui;
		this.active = ctx.hasUI;
	}

	/** Begin a request: accept progress updates again. */
	start(): void {
		this.finished = false;
	}

	/** Settle the request: clear the slot and stop accepting updates. */
	finish(): void {
		this.set(null);
		this.finished = true;
	}

	/** Set the progress text; `null` clears the slot. No-op if unchanged or settled. */
	set(message: string | null): void {
		if (this.finished) return;
		if (message === this.lastShown) return;
		this.lastShown = message;
		if (!this.active || !this.ui) return;
		this.ui.setStatus(WorkingMessageDisplay.SLOT_KEY, message ?? undefined);
	}
}
