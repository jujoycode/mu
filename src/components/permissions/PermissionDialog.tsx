// ask 다이얼로그 프레임 (설계: docs/08 2.2) — 풀 박스가 아니라 위쪽 라운드 보더
// 한 줄만. 터미널 스크롤백 친화 (pi append-only 철학과 일치).

import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "../../utils/theme.ts";

export interface DialogProps {
	/** bold + permission 색 */
	title: string;
	/** dim, 길면 앞쪽 truncate (뒤쪽이 위험한 인자를 담는 경우가 많다) */
	subtitle?: string;
	children: ReactNode;
}

export function Dialog({ title, subtitle, children }: DialogProps): ReactNode {
	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.permission}
			borderLeft={false}
			borderRight={false}
			borderBottom={false}
			marginTop={1}
			paddingX={1}
		>
			<Text bold color={theme.permission}>
				{title}
			</Text>
			{subtitle != null && (
				<Text dimColor wrap="truncate-start">
					{subtitle}
				</Text>
			)}
			<Box flexDirection="column" paddingX={1} marginTop={1}>
				{children}
			</Box>
		</Box>
	);
}
