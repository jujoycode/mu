// ask 프롬프트 (설계: docs/08 PART 2) — 게이트의 ask 판정을 사용자에게 묻는
// Ink 아일랜드. askUser()는 Promise를 반환하고, 완료되면 스스로 unmount한다
// (마지막 프레임은 스크롤백에 남는다 — append-only).
//
// P1 범위: 3-way(예 / 예-세션 / 아니오) + Tab 인라인 피드백 + esc=거부.
// don't-ask-again의 편집 가능한 규칙 입력은 게이트 Decision/Update 개정과 함께.

import { Box, render, Text } from "ink";
import { type ReactNode, useState } from "react";
import type { AskDecision } from "../../gate.ts";
import { Dialog } from "./PermissionDialog.tsx";
import { Select, type SelectOption } from "../CustomSelect/select.tsx";

export interface AskRequest {
	/** 다이얼로그 제목 — 예: "bash 실행 요청" */
	title: string;
	/** 실행하려는 내용 — 예: 명령어 전문 */
	subtitle: string;
	/** 매칭된 정책 패턴 (세션 허용의 대상) */
	pattern: string;
	/** true면 기본 포커스를 '아니오'에 (docs/07: prod 대상 등) */
	focusNo?: boolean;
	/** false면 '세션 동안 묻지 않기' 옵션을 숨긴다 (prod = 매번 명시 승인, docs/05) */
	allowSession?: boolean;
}

export interface AskResult {
	decision: AskDecision;
	/** Tab 피드백 — 허용이면 툴 결과에 합쳐지고, 거부면 거부 사유에 실린다 */
	feedback?: string;
}

type OptionValue = "yes" | "yes-session" | "no";

const FEEDBACK_PLACEHOLDER: Record<"yes" | "no", string> = {
	yes: "하고 나서 이렇게 해줘…",
	no: "말고 이렇게 해줘…",
};

function AskApp({
	request,
	onDone,
}: {
	request: AskRequest;
	onDone: (result: AskResult) => void;
}): ReactNode {
	// 모드(입력창 확장 여부)와 편집값을 분리 — 편집값 setter가 곧 함수형 업데이터라
	// Select의 onEdit에 그대로 넘길 수 있다 (stale 방지).
	const [yesMode, setYesMode] = useState(false);
	const [noMode, setNoMode] = useState(false);
	const [yesFeedback, setYesFeedback] = useState("");
	const [noFeedback, setNoFeedback] = useState("");

	const showSession = request.allowSession !== false;
	const options: SelectOption<OptionValue>[] = [
		yesMode
			? {
					kind: "input",
					value: "yes",
					label: "예",
					input: yesFeedback,
					placeholder: FEEDBACK_PLACEHOLDER.yes,
					onEdit: setYesFeedback,
				}
			: { value: "yes", label: "예" },
		...(showSession
			? [
					{
						value: "yes-session" as const,
						label: "예, 이 세션에선 묻지 않기",
						description: `패턴: ${request.pattern}`,
					},
				]
			: []),
		noMode
			? {
					kind: "input",
					value: "no",
					label: "아니오",
					input: noFeedback,
					placeholder: FEEDBACK_PLACEHOLDER.no,
					onEdit: setNoFeedback,
				}
			: { value: "no", label: "아니오" },
	];

	const handleSelect = (value: OptionValue) => {
		switch (value) {
			case "yes":
				// 빈 피드백 제출 = 입력 모드 취소 복귀 (값 있는 제출만 확정)
				if (yesMode && yesFeedback.trim() === "") return setYesMode(false);
				return onDone({ decision: "once", feedback: yesFeedback.trim() || undefined });
			case "yes-session":
				return onDone({ decision: "session" });
			case "no":
				if (noMode && noFeedback.trim() === "") return setNoMode(false);
				return onDone({ decision: "deny", feedback: noFeedback.trim() || undefined });
		}
	};

	const handleTab = (value: OptionValue) => {
		if (value === "yes") setYesMode((v) => !v);
		if (value === "no") setNoMode((v) => !v);
	};

	return (
		<Dialog title={request.title} subtitle={request.subtitle}>
			<Text>계속할까요?</Text>
			<Select
				options={options}
				initialValue={request.focusNo ? "no" : "yes"}
				onSelect={handleSelect}
				onCancel={() => onDone({ decision: "deny" })}
				onTab={handleTab}
			/>
			<Box marginTop={1}>
				<Text dimColor>↑↓ 이동 · ⏎ 선택 · tab 피드백 · esc 거부</Text>
			</Box>
		</Dialog>
	);
}

/** Ink 아일랜드를 띄우고 사용자의 결정을 기다린다. 호출자는 그동안 stdin을 놓아야 한다. */
export function askUser(request: AskRequest): Promise<AskResult> {
	return new Promise((resolve) => {
		const app = render(
			<AskApp
				request={request}
				onDone={(result) => {
					app.unmount();
					resolve(result);
				}}
			/>,
			{ exitOnCtrlC: false },
		);
	});
}

export { AskApp }; // 테스트용
