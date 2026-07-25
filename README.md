# mu

> 無에서 시작하는 팀 내부용 미니멀 코딩 에이전트 harness — TypeScript + Bun

**mu**는 팀 내부용 미니멀 코딩 에이전트다. 범용 코딩 능력으로 경쟁하지 않고,
범용 툴(Claude Code, Pi 등)이 구조적으로 접근할 수 없는 **팀 내부 컨텍스트와
시스템** — 내부 지식/스킬, SSH 인프라 — 에 가치를 건다. [pi](https://pi.dev)에서
영감을 받았다.

- **μ (micro)** — SI 접두어 10⁻⁶, "minimal"의 기호
- **無 (mu)** — 선불교 공안의 "질문 자체를 무효화하는 대답", 미니멀리즘 선언

## 설치

```bash
bun install        # 의존성 설치
bun link           # 전역 `mu` 명령 등록 (빌드 스텝 없음)
```

`ANTHROPIC_API_KEY`가 필요하다.

## 사용법

```bash
mu                 # 대화형 REPL
mu -c              # 이 디렉토리의 최근 세션을 이어서 REPL
mu -p "작업 설명"   # 원샷 (비대화형 — ask 게이트는 자동 차단)
```

환경 변수:

| 변수 | 용도 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 키 (필수) |
| `MU_MODEL` | 모델 (기본 `claude-sonnet-5`) |
| `MU_SESSION_DIR` | 세션 저장 위치 (기본 `~/.mu/sessions/`) |
| `MU_CONFIG_DIR` | 설정 위치 (기본 `~/.mu/`) |
| `MU_SKILLS_DIR` | 팀 스킬 레포 위치 (기본 `~/.mu/skills/`) |

## 기능

### 코어 루프 + 기본 도구
스트리밍 LLM 클라이언트(자체 SSE + 지수 백오프 재시도)와 툴콜 루프. 도구는
**read / write / edit / bash** 4개 + 아래 확장. `messages` 배열이 유일한 상태이며,
세션은 이 배열의 JSONL append로 저장된다.

### 권한 게이트
로컬 bash와 원격 실행에 공통 적용되는 **allow / ask / deny** 3레벨 게이트.
위험 명령(`rm -rf`, `sudo`, force push 등)은 실행 전 확인을 받고, 시크릿 노출
(`~/.ssh/id_*`, `.env` 출력)은 차단한다. 정책은 코드가 아니라 `policy.json`
(+ `~/.mu/policy.json` add-only 병합)에 있고, 모든 판정은 감사 로그로 남는다.

### remote_exec — SSH 원격 실행
등록된 호스트 별칭에서 명령을 실행한다. **모델은 별칭만 보고**, SSH 키·시크릿은
컨텍스트/로그에 절대 들어가지 않는다(로컬 ssh-agent + `~/.ssh/config`가 인증 처리).
환경 태그별 권한: **dev 자동 / staging 확인 / prod 매번 명시 승인**.

```json
// hosts.json (레포) 또는 ~/.mu/hosts.json (사용자)
{
  "hosts": [
    { "alias": "api-dev",  "purpose": "API 개발 서버", "env": "dev" },
    { "alias": "api-prod", "purpose": "API 프로덕션",   "env": "prod" }
  ]
}
```

### 스킬 시스템 — 팀 지식의 lazy loading
스킬 = **팀 git 레포의 폴더**(`SKILL.md` + 선택적 스크립트). 컨텍스트에는
스킬당 **요약 한 줄**만 상주하고, 본문은 `load_skill` 툴로 필요할 때만 로드한다
(컨텍스트 부풀림 방지). `search_knowledge` 툴로 런북·문서를 grep 검색한다.

```markdown
---
name: deploy-api
summary: API 서버 배포 절차 (이 줄만 상시 컨텍스트에 올라감)
---
(본문: 상세 절차, 주의사항 — load_skill로 온디맨드 로드)
```

프로젝트 `.mu/skills/` + 팀 레포 `~/.mu/skills/`를 병합한다(같은 이름은 프로젝트 우선).

### 서브에이전트
격리된 컨텍스트로 조사·분석 서브태스크를 위임하는 `subagent` 툴. 메인 컨텍스트를
채우지 않고 코드베이스를 탐색한다. **코어 비침습**(내부에서 Agent 인스턴스를 새로
만들 뿐 코어 루프는 그대로), 재귀 금지, 읽기 중심 툴셋.

### 토큰/비용 추적 · TUI
모델별 단가와 캐시 회계로 턴·세션 비용을 실시간 표시. Ink 기반 권한 프롬프트 UI,
스피너, 웰컴 마스코트(円相).

## 개발

```bash
bun run src/cli.ts     # 로컬 실행
bunx tsc --noEmit      # 타입 체크
bun test               # 테스트 (125개)
```

CI(GitHub Actions)가 push/PR마다 타입 체크와 테스트를 실행한다.

## 아키텍처

```
src/
├── agent.ts              # 코어 루프 (~150줄 유지 목표)
├── llm.ts                # Anthropic 스트리밍 래퍼 (자체 SSE + 재시도)
├── cli.ts                # 진입점 + REPL
├── gate.ts + policy.json # 권한 게이트
├── session.ts            # 세션 저장 (JSONL append)
├── tools/                # read/write/edit/bash + remoteExec/loadSkill/searchKnowledge/subagent
├── remote/ + hosts.json  # 호스트 레지스트리
├── skills/               # 스킬 탐색 + lazy 요약
├── components/           # TUI (Ink) — 폴더 구조는 Claude Code와 동일
├── utils/                # theme, cost
└── constants/            # spinnerVerbs

MU.md                     # mu 런타임이 소비하는 시스템 프롬프트
docs/                     # 설계 문서 (00~09)
```

설계 배경과 로드맵은 [`docs/`](docs/)에 있다 —
[개요](docs/00-overview.md) · [로드맵](docs/04-roadmap.md) ·
[설계 노트](docs/05-design-notes.md).

## 설계 원칙

- **`messages` 배열이 유일한 상태다.** 그 밖의 상태를 만들지 않는다.
- **툴 실패는 크래시가 아니라 정보다.** 에러 문자열을 모델에게 반환한다.
- **프롬프트는 `MU.md`에.** 코드에 하드코딩하지 않는다.
- **SSH 키·시크릿은 코드/컨텍스트/로그에 절대 넣지 않는다.** 모델은 호스트 별칭만 본다.
- **코어에 넣기 전에 자문한다: "스킬이나 확장으로 가능한가?"**
