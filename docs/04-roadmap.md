# 04. 로드맵

> 현재 상태 (2026-07-26): **P0·P1·P2의 코드 항목은 모두 구현 완료**되어 main에 있다
> (테스트 125개 통과, CI 상시 실행). 남은 것은 두 종류다 —
> ① 팀 스펙이 있어야 만들 수 있는 팀 전용 툴(사내 API·파이프라인),
> ② 실환경/실사용 검증(실 API 키·실 SSH 호스트·팀원 도그푸딩). 즉 **P3(실사용) 단계**.

## P0 — 코어 루프 (1–2주) — 구현 완료

- 스트리밍 LLM 클라이언트 (Anthropic 단일 프로바이더)
- 툴콜 루프 + 기본 도구 4개 (read / write / edit / bash)
- 단일 세션, 최소 REPL

**완료 조건**: 실제 팀 레포에서 작은 버그픽스 하나를
mu가 사람 개입 없이 diff까지 뽑아내면 클리어.

> 검증 현황: 하네스 E2E는 **커밋된 테스트로 상시 검증** (tests/agent.e2e.test.ts —
> 모의 LLM으로 코어 루프 + 실제 툴(edit/bash) + 게이트를 함께 돌려 off-by-one
> 버그픽스를 무개입 완수). CI(GitHub Actions)가 push/PR마다 실행한다.
> 실모델 + 실레포 검증은 API 키 있는 환경에서 남음.

## P1 — 신뢰성 + remote_exec — 구현 완료

- ✅ 세션 저장/재개 — 선형 JSONL append (docs/06 결정 4), `mu -c`로 재개
- ✅ bash 안전장치 — allow/ask/deny 권한 게이트 + 감사 로그 (설계: docs/05,
  정책: policy.json + ~/.mu/policy.json add-only 병합)
- ✅ TUI: Ink 도입 + Claude Code 스타일 ask 프롬프트 UI (설계: docs/08, docs/07 일부 개정)
  + 게이트 Decision/Update 모델 개정 (docs/08 PART 1)
- ✅ 재시도·에러 처리 (llm.ts: 지수 백오프 + retry-after + abortable, MAX_RETRIES=3)
  · ✅ 토큰/비용 추적 (src/utils/cost.ts: 모델별 단가 + 캐시 회계, 턴/세션 요약)
- ✅ 브랜드 감성: 스피너 글리프 + 랜덤 멘트, 웰컴 배너 마스코트 (설계: docs/09)
- ✅ **`remote_exec` 툴** — 호스트 레지스트리(hosts.json) + env→레벨 게이트
  (dev allow / staging ask / prod 명시 승인) + 감사 로그 (구현: src/remote, src/tools/remoteExec.ts)

> 조정 이력: remote_exec P2 → P1.
> 이유: 매일 아픈 페인포인트라 초기 체감 가치가 가장 큼.
>
> P1 코드 항목은 모두 구현 완료. P1→P2 게이트("remote_exec로 dev 서버 작업 1건 완수 +
> 세션 재개")의 실환경 검증은 실제 호스트가 있는 환경에서 남음.

## P2 — 스킬 시스템 (본체) — 구현 완료

- ✅ git 기반 팀 스킬 레포 + lazy loading (구현: src/skills/registry.ts) —
  `.mu/skills/`(프로젝트) + `~/.mu/skills/`(팀 레포) 병합, SKILL.md frontmatter,
  요약 한 줄만 상시 컨텍스트에 주입
- ✅ `load_skill` 툴 (본문 온디맨드 로드) + `search_knowledge` 툴 (스킬 레포 grep)
- 사내 API 호출 툴, 배포·테스트 파이프라인 연동 등 "팀 전용" 도구 확충
  — 팀 API/파이프라인 스펙 필요, 도그푸딩하며 추가 (mu 코드로는 구현 불가 — 팀 입력 대기)
- ✅ 서브에이전트 (확장 레이어, 코어 비침습 — src/tools/subagent.ts) + 진행 표시
  (들여쓴 툴 활동 라인; Ink 풀 트리 표시는 이후) (설계: docs/07)
- ✅ 팀 컨벤션 스킬 예시(.mu/skills/mu-dev) — 시스템 프롬프트에 스킬 사용 지침 반영(MU.md)

> P2 코드 항목 완료 (스킬 시스템·load_skill·search_knowledge·서브에이전트).
> 팀 전용 API/파이프라인 툴은 팀 스펙이 나와야 구현 가능 → P3 도그푸딩과 병행.

## P3 — 도그푸딩 (폴리시 대신) ← 현재 단계

내부용이므로 TUI 폴리시·패키징·문서화보다 **실사용 확산**이 우선.
코드가 아니라 실제 사용의 영역 — 여기서부터는 굴려보며 팀 전용 툴을 붙인다.

- 2주차부터 제작자 본인이 매일 사용
- P2 시점에 팀원 투입
- 지표 측정 시작: 주간 실사용 인원, mu로 완수한 태스크 수
- 병행: 사내 API·배포/테스트 파이프라인 툴 (팀 스펙 나오는 대로 P2 툴셋에 추가)

## 통과 기준 요약

| 단계 | 게이트 | 상태 |
|------|--------|------|
| P0 → P1 | 실레포 버그픽스 1건 무개입 완수 | ✅ E2E 테스트로 검증 (실모델은 남음) |
| P1 → P2 | remote_exec로 dev 서버 작업 1건 완수 + 세션 재개 동작 | ⚠️ 코드 완성, 실 호스트 검증 남음 |
| P2 → P3 | 팀원 1명 이상이 스킬 레포 pull 받아 실사용 | ⬜ 실사용 필요 |
