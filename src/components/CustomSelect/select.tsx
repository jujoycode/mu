// 키보드 셀렉터 (설계: docs/08 2.1) — ↑↓ 이동, ⏎ 선택, esc 취소, tab 토글.
// input형 옵션: 포커스 중 타이핑으로 값을 인라인 편집 (don't-ask-again 규칙,
// Tab 피드백 입력이 이걸 쓴다). 편집 상태는 부모가 소유한다 (controlled).

import { Box, useInput } from "ink";
import { Text } from "ink";
import { type ReactNode, useState } from "react";
import { ListItem } from "../design-system/ListItem.tsx";
import { theme } from "../../utils/theme.ts";

export type SelectOption<T extends string> = {
	value: T;
	label: string;
	description?: string;
} & (
	| { kind?: "plain" }
	| {
			kind: "input";
			/** 현재 편집값 (부모 state) */
			input: string;
			placeholder?: string;
			/** 함수형 업데이트 — 빠른 연속 키 입력에도 stale 값을 읽지 않는다 */
			onEdit: (updater: (prev: string) => string) => void;
	  }
);

export interface SelectProps<T extends string> {
	options: SelectOption<T>[];
	initialValue?: T;
	/** ⏎ — input형이면 현재 편집값은 부모 state에 이미 있다 */
	onSelect: (value: T) => void;
	/** esc / ctrl+c */
	onCancel?: () => void;
	/** tab — 피드백 확장 토글 등 (부모가 옵션 배열을 바꾼다) */
	onTab?: (focused: T) => void;
	onFocusChange?: (focused: T) => void;
}

export function Select<T extends string>({
	options,
	initialValue,
	onSelect,
	onCancel,
	onTab,
	onFocusChange,
}: SelectProps<T>): ReactNode {
	const initialIndex = Math.max(
		0,
		options.findIndex((o) => o.value === initialValue),
	);
	const [index, setIndex] = useState(initialIndex);
	const clamped = Math.min(index, options.length - 1);
	const focused = options[clamped];

	const move = (delta: number) => {
		const next = (clamped + delta + options.length) % options.length;
		setIndex(next);
		const opt = options[next];
		if (opt) onFocusChange?.(opt.value);
	};

	useInput((char, key) => {
		if (key.upArrow) return move(-1);
		if (key.downArrow) return move(1);
		if (key.return) return focused && onSelect(focused.value);
		if (key.escape || (key.ctrl && char === "c")) return onCancel?.();
		if (key.tab) return focused && onTab?.(focused.value);

		// input형 옵션 인라인 편집 (함수형 업데이트로 stale 방지)
		if (focused && focused.kind === "input") {
			if (key.backspace || key.delete) return focused.onEdit((prev) => prev.slice(0, -1));
			if (char && !key.ctrl && !key.meta) return focused.onEdit((prev) => prev + char);
		}
	});

	return (
		<Box flexDirection="column">
			{options.map((option, i) => {
				const isFocused = i === clamped;
				if (option.kind === "input") {
					const empty = option.input === "";
					return (
						<ListItem key={option.value} isFocused={isFocused} description={option.description} styled={false}>
							<Text color={isFocused ? theme.accent : undefined}>
								{option.label}
								{": "}
								{empty ? (
									<Text dimColor>{option.placeholder ?? ""}</Text>
								) : (
									<Text>{option.input}</Text>
								)}
								{isFocused && <Text color={theme.accent}>▌</Text>}
							</Text>
						</ListItem>
					);
				}
				return (
					<ListItem key={option.value} isFocused={isFocused} description={option.description}>
						{option.label}
					</ListItem>
				);
			})}
		</Box>
	);
}
