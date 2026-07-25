// 토큰/비용 추적 (설계: docs/04 P1). Usage는 llm.ts가 메시지별로 캡처한다 —
// 여기서는 모델별 단가로 환산하고 세션 누적을 관리한다.
//
// 캐시 회계: 캐시 읽기는 기본 입력가의 ~0.1×, 캐시 쓰기는 ~1.25×(5분 TTL).
// input(=uncached 잔여)·output은 정가. 값은 추정치다 (프로바이더 청구가 정본).

import { type Usage, emptyUsage } from "../types.ts";

export interface ModelPrice {
	/** USD per 1M input tokens */
	input: number;
	/** USD per 1M output tokens */
	output: number;
}

// 100만 토큰당 USD. 미등록 모델은 sonnet 요율로 폴백한다 (경고 없이 — 표시용이라 치명적이지 않다).
export const MODEL_PRICING: Record<string, ModelPrice> = {
	"claude-fable-5": { input: 10, output: 50 },
	"claude-mythos-5": { input: 10, output: 50 },
	"claude-opus-5": { input: 5, output: 25 },
	"claude-opus-4-8": { input: 5, output: 25 },
	"claude-opus-4-7": { input: 5, output: 25 },
	"claude-opus-4-6": { input: 5, output: 25 },
	"claude-sonnet-5": { input: 3, output: 15 },
	"claude-sonnet-4-6": { input: 3, output: 15 },
	"claude-haiku-4-5": { input: 1, output: 5 },
};

const FALLBACK_PRICE: ModelPrice = { input: 3, output: 15 };
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export function priceFor(model: string): ModelPrice {
	return MODEL_PRICING[model] ?? FALLBACK_PRICE;
}

/** 단일 Usage의 추정 비용(USD). */
export function computeCost(model: string, usage: Usage): number {
	const p = priceFor(model);
	const inputCost = (usage.input + usage.cacheRead * CACHE_READ_MULTIPLIER + usage.cacheWrite * CACHE_WRITE_MULTIPLIER) * p.input;
	const outputCost = usage.output * p.output;
	return (inputCost + outputCost) / 1_000_000;
}

export function addUsage(a: Usage, b: Usage): Usage {
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		cacheRead: a.cacheRead + b.cacheRead,
		cacheWrite: a.cacheWrite + b.cacheWrite,
	};
}

/** API에 실제로 청구되는 총 토큰 (uncached + output + 캐시 읽기/쓰기). */
export function totalTokens(usage: Usage): number {
	return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

export function formatCost(usd: number): string {
	if (usd === 0) return "$0.00";
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 세션 동안 모델별 usage를 누적하고 총 비용을 계산한다. */
export class CostTracker {
	private perModel = new Map<string, Usage>();

	add(model: string, usage: Usage): void {
		const prev = this.perModel.get(model) ?? emptyUsage();
		this.perModel.set(model, addUsage(prev, usage));
	}

	get totalUsage(): Usage {
		let total = emptyUsage();
		for (const usage of this.perModel.values()) total = addUsage(total, usage);
		return total;
	}

	get totalCost(): number {
		let cost = 0;
		for (const [model, usage] of this.perModel) cost += computeCost(model, usage);
		return cost;
	}

	/** 예: "12.3k tokens · $0.04" */
	summary(): string {
		return `${formatTokens(totalTokens(this.totalUsage))} tokens · ${formatCost(this.totalCost)}`;
	}
}
