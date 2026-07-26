# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# mu

팀 내부용 미니멀 코딩 에이전트 harness. TypeScript + Bun.
설계 철학과 배경: @docs/00-overview.md · 현재 단계와 로드맵: @docs/04-roadmap.md

## 명령어

- `bun install` — 의존성 설치 (**테스트 전 필수** — ink-testing-library 등 devDependencies 없으면 tests/ask.test.tsx가 깨진다)
- `bun run src/cli.ts` — 로컬 실행 (`ANTHROPIC_API_KEY` 필요)
- `bunx tsc --noEmit` — 타입 체크
- `bun test` — 전체 테스트 (125개 / 13파일)
- `bun test tests/gate.test.ts` — 단일 파일 · `bun test -t "이름 패턴"` — 이름 매칭
- `bun link` — 전역 `mu` 명령 등록 (빌드 스텝 없음)

CI(.github/workflows/ci.yml)가 push/PR마다 타입 체크 + 테스트를 실행한다.

실행 모드: `mu`(REPL) · `mu -c`(cwd의 최근 세션 재개) · `mu -p "task"`(원샷, 비대화형 — ask 게이트는 자동 차단).
환경 변수: `MU_MODEL`(기본 claude-sonnet-5) · `MU_SESSION_DIR` · `MU_SKILLS_DIR` · `MU_CONFIG_DIR`.

## 코어 계약 (여러 파일에 걸친 불변식)

- 루프 종료 조건은 하나뿐: **tool call 없는 assistant 응답 = 자연 종료** (agent.ts)
- `llm.ts`의 `streamAssistant`는 **절대 throw하지 않는다** — 실패는 `stopReason: "error" | "aborted"`로 인코딩된 AssistantMessage로 반환된다
- `stopReason: "length"`인 턴의 tool call은 실행하지 않는다 (truncation으로 인자가 깨졌을 수 있음 — 에러 결과로 재요청을 유도)
- 게이트는 코어의 `beforeToolCall` 단일 훅에, 세션 저장은 `onMessage` 훅에 꽂힌다. 코어 루프는 게이트/세션/TUI를 모른다
- `types.ts`의 Message 타입(user / assistant / toolResult)이 곧 세션 파일 포맷이다
- 게이트 판정은 전부 감사 로그(`~/.mu/audit.jsonl`)에 남는다. ask 승인에는 세션 캐시(`decision: "session"`)가 있지만 prod는 예외 — 매번 명시 승인
- 설정 병합: `policy.json` + `~/.mu/policy.json`은 **add-only**(사용자 파일로 기본 deny를 제거할 수 없다), `hosts.json` + `~/.mu/hosts.json`은 별칭 기준 사용자 우선

## 아키텍처 요점

- `src/agent.ts` — 코어 루프. **~150줄 유지 목표.** 이 파일이 커지면 설계가 잘못된 것
- `src/llm.ts` — Anthropic 스트리밍 래퍼 (프로바이더는 당분간 1개). SDK 내장 재시도가 AbortSignal을 무시해서 자체 SSE 파싱 + abortable 지수 백오프(MAX_RETRIES=3)로 구현
- `src/tools/` — 툴 구현. 인터페이스는 `{ name, description, inputSchema, execute }`로 고정. 기본 4개(read/write/edit/bash)는 `tools/index.ts`의 `createCoreTools`
- `src/session.ts` — 세션 저장 (선형 JSONL append, `~/.mu/sessions/<cwd 인코딩>/` — 첫 줄 헤더, 이후 한 줄 = 한 메시지)
- `src/gate.ts` + `policy.json` — allow/ask/deny 권한 게이트. 정책은 설정 파일에 (코드 금지)
- `src/remote/` + `src/tools/remoteExec.ts` + `hosts.json` — remote_exec. 모델은 별칭만 본다.
  env(dev/staging/prod)→레벨은 gate.ts가 판정: dev 자동 / staging ask(호스트별 세션 캐시) / prod 매번 명시 승인.
  SSH 인증은 로컬 ssh-agent + ~/.ssh/config (설계: docs/05)
- `src/skills/` + `src/tools/{loadSkill,searchKnowledge}.ts` — 스킬 시스템. lazy loading:
  요약만 상주(`registry.summaryBlock()`이 시스템 프롬프트에 주입), 본문은 load_skill로 온디맨드.
  스킬 = `.mu/skills/`(프로젝트)·`~/.mu/skills/`(팀)의 SKILL.md 폴더, 같은 이름은 프로젝트 우선 (설계: docs/05)
- `src/tools/subagent.ts` — 서브에이전트. **코어 비침습**: 내부에서 Agent 인스턴스를 새로
  만들 뿐 코어 루프는 그대로. 재귀 금지(subagent 툴 미제공), 읽기 중심 툴셋(read/bash/skill/knowledge — 쓰기·원격 없음), 비대화형 게이트 (설계: docs/07)
- `src/components/`, `src/utils/`, `src/constants/` — TUI(Ink). **폴더 구조는 Claude Code와 동일**하게 간다
  (`components/permissions/` ask UI, `components/CustomSelect/`, `components/Spinner.tsx`,
  `components/LogoV2/` 마스코트·웰컴, `utils/theme.ts`). 설계: docs/08·09
- `MU.md` — **mu 런타임이 소비하는 시스템 프롬프트.** 이 CLAUDE.md와 다른 파일이니 혼동 금지

## 절대 규칙

- `messages` 배열이 유일한 상태다. 그 밖에 상태를 만들지 마라 (세션 저장 = 이 배열의 JSON 덤프)
- 툴 실패는 throw 금지. `{ content, isError: true }`로 에러 문자열을 모델에게 반환하라 — 실패는 크래시가 아니라 정보다 (루프의 방어적 try/catch는 규약 위반 대비용일 뿐)
- 프롬프트 수정은 MU.md에서. 코드에 프롬프트 하드코딩 금지
- SSH 키·시크릿을 코드/컨텍스트/로그에 절대 넣지 마라. 모델은 호스트 별칭만 본다
- 코어에 기능을 추가하기 전에 자문하라: "스킬이나 확장으로 가능한가?" 가능하면 코어에 넣지 마라
- 설계 결정을 바꾸면 docs/의 해당 문서를 같은 커밋에서 업데이트하라
