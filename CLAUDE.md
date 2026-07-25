# mu

팀 내부용 미니멀 코딩 에이전트 harness. TypeScript + Bun.
설계 철학과 배경: @docs/00-overview.md · 현재 단계와 로드맵: @docs/04-roadmap.md

## 명령어

- `bun install` — 의존성 설치
- `bun run src/cli.ts` — 로컬 실행
- `bunx tsc --noEmit` — 타입 체크
- `bun test` — 테스트
- `bun link` — 전역 `mu` 명령 등록

## 아키텍처 요점

- `src/agent.ts` — 코어 루프. **~150줄 유지 목표.** 이 파일이 커지면 설계가 잘못된 것
- `src/llm.ts` — Anthropic 스트리밍 래퍼 (프로바이더는 당분간 1개)
- `src/tools/` — 툴 구현. 인터페이스는 `{ name, description, inputSchema, execute }`로 고정
- `src/session.ts` — 세션 저장 (선형 JSONL append, `~/.mu/sessions/`)
- `src/gate.ts` + `policy.json` — allow/ask/deny 권한 게이트. 정책은 설정 파일에 (코드 금지)
- `src/remote/` + `src/tools/remoteExec.ts` + `hosts.json` — remote_exec. 모델은 별칭만 본다.
  env(dev/staging/prod)→레벨은 gate.ts가 판정. SSH 인증은 로컬 ssh-agent + ~/.ssh/config (설계: docs/05)
- `src/skills/` + `src/tools/{loadSkill,searchKnowledge}.ts` — 스킬 시스템. lazy loading:
  요약만 상주, 본문은 load_skill로 온디맨드. 스킬 = `.mu/skills/`·`~/.mu/skills/`의 폴더 (설계: docs/05)
- `src/tools/subagent.ts` — 서브에이전트. **코어 비침습**: 내부에서 Agent 인스턴스를 새로
  만들 뿐 코어 루프는 그대로. 재귀 금지(subagent 툴 미제공), 읽기 중심 툴셋, 비대화형 게이트 (설계: docs/07)
- `src/components/`, `src/utils/`, `src/constants/` — TUI(Ink). **폴더 구조는 Claude Code와 동일**하게 간다
  (`components/permissions/` ask UI, `components/CustomSelect/`, `components/Spinner.tsx`,
  `components/LogoV2/` 마스코트·웰컴, `utils/theme.ts`). 설계: docs/08·09
- `MU.md` — **mu 런타임이 소비하는 시스템 프롬프트.** 이 CLAUDE.md와 다른 파일이니 혼동 금지

## 절대 규칙

- `messages` 배열이 유일한 상태다. 그 밖에 상태를 만들지 마라 (세션 저장 = 이 배열의 JSON 덤프)
- 툴 실패는 throw 금지. 에러 문자열을 모델에게 반환하라 — 실패는 크래시가 아니라 정보다
- 프롬프트 수정은 MU.md에서. 코드에 프롬프트 하드코딩 금지
- SSH 키·시크릿을 코드/컨텍스트/로그에 절대 넣지 마라. 모델은 호스트 별칭만 본다
- 코어에 기능을 추가하기 전에 자문하라: "스킬이나 확장으로 가능한가?" 가능하면 코어에 넣지 마라
- 설계 결정을 바꾸면 docs/의 해당 문서를 같은 커밋에서 업데이트하라
