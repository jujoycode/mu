# 07. TUI 디자인 — pi 스타일 채택

> 방향: pi의 비주얼 아이덴티티를 채택하되, 특히 **question(ask 프롬프트)**과
> **서브에이전트 진행 표시** 두 UI 표면을 잘 만든다.
> 근거 분석: docs/06 · pi 파일 경로는 `packages/tui`, `packages/coding-agent` 기준.
>
> ⚠️ 개정 (2026-07-25, docs/08): 렌더링 스택은 자체 이식 대신 **Ink 도입**으로 변경,
> ask 프롬프트는 **Claude Code 스타일**로 결정. 아래 "TUI 코어 이식" 및
> "Question / ask 프롬프트" 절은 docs/08이 대체한다. 비주얼 문법(카드/diff/footer)과
> 서브에이전트 표시 관용구는 계속 유효.

## 채택 범위

pi의 tui 패키지는 ~12k줄이지만 **핵심 코어는 ~2,500줄**. mu는 그 코어만 이식한다.

| 구분 | 대상 |
|------|------|
| 이식 | `Component`/`Container` + differential flush (tui.ts 핵심 ~700줄), `Text`/`Box`/`Spacer`, selector 패턴(113줄), `Loader`, `renderDiff`(147줄), `Theme.fg/bg` + JSON 테마 토큰 |
| 선택 | `Markdown`(858줄, marked 의존 — 초기엔 plain Text로 대체), footer 표기 규약 |
| 스킵 | 풀 멀티라인 에디터(2351줄), 키맵 시스템(1401줄), 자동완성, Kitty 이미지, 256색 근사, 오버레이 스택 |

## 아키텍처 (pi 모델 그대로)

- 컴포넌트 계약은 하나: **`render(width): string[]`** — ANSI 포함 완성된 라인 배열 반환
- `Container`는 자식 라인을 세로로 concat. 레이아웃 시스템 없음
- 루트가 이전 프레임과 라인 diff → 바뀐 구간만 다시 그림 (16ms 스로틀,
  synchronized update `\x1b[?2026h/l`로 깜빡임 방지)
- 터미널 스크롤백을 그대로 쓰는 append-only 로그 친화 구조

## 비주얼 문법 (pi 관례 채택)

역할 구분은 "배경 카드 유무 + 색"으로:

| 요소 | 스타일 |
|------|--------|
| user 메시지 | 회색 배경 카드 (`userMessageBg`) |
| assistant 텍스트 | 카드 없음, 마크다운 |
| 툴콜 | 상태색 틴트 카드 — pending(회보라) / success(초록끼) / error(빨강끼) |
| edit diff | 삭제 빨강 / 추가 초록 / context 회색, 1:1 라인 변경 시 word-level 반전 강조 |
| 에러 텍스트 | `error` 빨강 |

테마는 JSON 토큰(dark/light). **최소 토큰셋 ~15개로 pi 룩앤필의 90% 재현**:
`accent, border, text, muted, dim, success, error, warning, userMessageBg,
toolPendingBg/SuccessBg/ErrorBg, toolDiffAdded/Removed/Context`

색 적용은 pi 방식: fg는 `\x1b[39m`, bg는 `\x1b[49m`로만 리셋 → fg/bg 독립 중첩 가능.

툴콜 표기 관례: `read path.ts:10-20`(path=accent), `$ command`(bash),
`edit path` + diff 프리뷰. 접힘/펼침(Ctrl+O): 접힘 시 결과 10줄
(read 성공은 헤더만), `... (N more lines, Ctrl+O to expand)`.

## Question / ask 프롬프트 (권한 게이트 UI) — 핵심 표면 1

pi의 `ExtensionSelectorComponent`(113줄) 패턴을 통째로 이식한다.
오버레이가 아니라 **입력 에디터 자리를 교체**하고 Promise로 결과를 반환하는 방식
(`await ui.select(title, options)`) — 확인이 끝나면 에디터로 복귀.

레이아웃:

```
──────────────────────────────────────────  ← border 구분선
 ⚠ Permission required                      ← warning + bold
   bash: rm -rf ./build                     ← muted (edit이면 diff 프리뷰)

 → Allow once                               ← 선택 항목: accent + "→ "
   Allow for this session
   Deny

 ↑↓ navigate  ⏎ select  esc cancel          ← 키 힌트 (dim)
──────────────────────────────────────────
```

규칙:
- 선택지는 3-way: `Allow once` / `Allow for this session` / `Deny`
- **Esc = Deny** (안전한 기본값). 거부 시 모델에는 에러 문자열 반환 (docs/05 게이트 규약)
- prod remote_exec 승인은 오선택 방지를 위해 기본 포커스를 `Deny`에 둔다
- 비대화형 환경(`-p` 원샷 모드 등)에서는 ask = 자동 차단 (pi `permission-gate.ts`와 동일)
- timeout 옵션(카운트다운 후 자동 해제)은 pi에 있으나 mu는 보류

일반 질문(선택지 + 자유 입력)은 pi `examples/extensions/question.ts` 패턴 참조:
옵션 리스트 마지막에 "직접 입력" 항목 → 선택 시 인라인 입력기로 전환.

## 서브에이전트 진행 표시 — 핵심 표면 2

서브에이전트 자체는 **코어가 아니라 확장 레이어** (pi와 동일 — 별도 `mu --mode json`
프로세스 spawn + stdout JSON 이벤트 파싱). 코어 루프에는 손대지 않는다.

렌더링 관용구 (pi `examples/extensions/subagent/index.ts:744-1013` 참조):

- 상태 아이콘: `✓`(success) / `✗`(error) / `⏳`(실행 중, warning) / `◐`(부분 실패)
- 병렬 헤더: `⏳ 3/8 done, 2 running` → 완료 시 `✓ 8/8 tasks`
- 중첩 툴콜은 `→ ` prefix 들여쓰기로 한 줄씩:
  ```
  ✓ reviewer (project)
  → read src/agent.ts
  → bash $ bun test
  최종 출력 미리보기 (접힘 시 3줄)
  ```
- 접힘 시 최근 10개 항목만 + `... N earlier items`
- 펼침 시 구조화 섹션: `─── Task ───` / `─── Output ───` 텍스트 구분선(muted) +
  최종 출력은 마크다운 + 토큰/비용 한 줄(dim)

## Footer (상태줄)

pi 규약 차용, 2줄:

1. `~/path (git-branch)` — 전부 dim
2. 좌측 `↑12k ↓3.4k R45k W2k $0.123` / 우측 `모델명` —
   컨텍스트 사용률은 70% 초과 시 warning, 90% 초과 시 error 색

## 단계 배치

| 단계 | TUI 작업 |
|------|----------|
| P0 (현재) | 최소 REPL — ANSI 직접 출력 (`⏺ tool(...)`, dim/red). 컴포넌트 시스템 없음 |
| P1 | TUI 코어 이식 (Component/diff flush, Text/Box, 테마 토큰) + **ask 프롬프트** (권한 게이트와 함께) + footer |
| P2 | 서브에이전트 확장 + 진행 표시, 마크다운 렌더링 |
