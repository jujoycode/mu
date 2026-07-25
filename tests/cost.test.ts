import { describe, expect, test } from "bun:test";
import {
	CostTracker,
	computeCost,
	formatCost,
	formatTokens,
	MODEL_PRICING,
	priceFor,
	totalTokens,
} from "../src/utils/cost";
import type { Usage } from "../src/types";

const usage = (o: Partial<Usage>): Usage => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	...o,
});

describe("computeCost", () => {
	test("sonnet-5: 1M input + 1M output = $3 + $15", () => {
		const cost = computeCost("claude-sonnet-5", usage({ input: 1_000_000, output: 1_000_000 }));
		expect(cost).toBeCloseTo(18, 6);
	});

	test("캐시 읽기는 입력가의 0.1×", () => {
		// 1M 캐시읽기 @ sonnet($3) → $0.30
		expect(computeCost("claude-sonnet-5", usage({ cacheRead: 1_000_000 }))).toBeCloseTo(0.3, 6);
	});

	test("캐시 쓰기는 입력가의 1.25×", () => {
		// 1M 캐시쓰기 @ sonnet($3) → $3.75
		expect(computeCost("claude-sonnet-5", usage({ cacheWrite: 1_000_000 }))).toBeCloseTo(3.75, 6);
	});

	test("fable-5는 sonnet보다 비싸다", () => {
		const u = usage({ input: 1_000_000, output: 1_000_000 });
		expect(computeCost("claude-fable-5", u)).toBeGreaterThan(computeCost("claude-sonnet-5", u));
		expect(computeCost("claude-fable-5", u)).toBeCloseTo(60, 6); // $10 + $50
	});

	test("미등록 모델은 sonnet 요율로 폴백", () => {
		const u = usage({ input: 1_000_000 });
		expect(computeCost("some-unknown-model", u)).toBe(computeCost("claude-sonnet-5", u));
	});
});

describe("priceFor / 가격표", () => {
	test("주요 모델 등록 확인", () => {
		expect(priceFor("claude-opus-5")).toEqual({ input: 5, output: 25 });
		expect(priceFor("claude-haiku-4-5")).toEqual({ input: 1, output: 5 });
		expect(MODEL_PRICING["claude-fable-5"]).toEqual({ input: 10, output: 50 });
	});
});

describe("totalTokens", () => {
	test("네 종류 토큰을 모두 더한다", () => {
		expect(totalTokens(usage({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }))).toBe(100);
	});
});

describe("format 헬퍼", () => {
	test("formatTokens", () => {
		expect(formatTokens(999)).toBe("999");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(12_300)).toBe("12k");
		expect(formatTokens(2_000_000)).toBe("2.0M");
	});

	test("formatCost", () => {
		expect(formatCost(0)).toBe("$0.00");
		expect(formatCost(0.0012)).toBe("$0.0012");
		expect(formatCost(0.42)).toBe("$0.42");
	});
});

describe("CostTracker", () => {
	test("여러 모델의 usage를 누적하고 합산 비용을 낸다", () => {
		const t = new CostTracker();
		t.add("claude-sonnet-5", usage({ input: 1_000_000 })); // $3
		t.add("claude-sonnet-5", usage({ output: 1_000_000 })); // $15
		t.add("claude-haiku-4-5", usage({ input: 1_000_000 })); // $1
		expect(t.totalCost).toBeCloseTo(19, 6);
		expect(totalTokens(t.totalUsage)).toBe(3_000_000);
	});

	test("summary 문자열", () => {
		const t = new CostTracker();
		t.add("claude-sonnet-5", usage({ input: 12_000, output: 300 }));
		expect(t.summary()).toContain("tokens");
		expect(t.summary()).toContain("$");
	});

	test("빈 트래커는 0", () => {
		const t = new CostTracker();
		expect(t.totalCost).toBe(0);
		expect(totalTokens(t.totalUsage)).toBe(0);
	});
});
