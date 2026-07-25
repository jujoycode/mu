// 선택 UI의 행 하나 (설계: docs/08 2.2) — ❯/✓/↑↓ 인디케이터 + 상태색.
// ask 전용이 아닌 범용: 이후 모델 선택 등 다른 리스트에서 재사용.

import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "../../utils/theme.ts";

export interface ListItemProps {
	/** 키보드 포커스 — ❯ 포인터 + accent 색 */
	isFocused: boolean;
	/** 확정된 항목 — ✓ + success 색 */
	isSelected?: boolean;
	children: ReactNode;
	/** 라벨 아래 들여쓰기 2 + muted로 표시 */
	description?: string;
	/** 리스트 잘림 힌트 (포커스가 아닐 때만 의미 있음) */
	scrollHint?: "up" | "down";
	/** true(기본)면 상태색을 입힌 Text로 감싼다. false면 children 그대로 */
	styled?: boolean;
}

export function ListItem({
	isFocused,
	isSelected = false,
	children,
	description,
	scrollHint,
	styled = true,
}: ListItemProps): ReactNode {
	const indicator = isFocused ? (
		<Text color={theme.accent}>❯</Text>
	) : scrollHint ? (
		<Text dimColor>{scrollHint === "down" ? "↓" : "↑"}</Text>
	) : (
		<Text> </Text>
	);

	const color = isSelected ? theme.success : isFocused ? theme.accent : undefined;

	return (
		<Box flexDirection="column">
			<Box flexDirection="row" gap={1}>
				{indicator}
				{styled ? <Text color={color}>{children}</Text> : children}
				{isSelected && <Text color={theme.success}>✓</Text>}
			</Box>
			{description && (
				<Box paddingLeft={2}>
					<Text color={theme.muted}>{description}</Text>
				</Box>
			)}
		</Box>
	);
}
