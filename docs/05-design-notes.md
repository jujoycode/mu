# 05. 설계 초안 — 권한 게이트 & remote_exec & 스킬 시스템

> P1/P2 진입 시 이 문서를 스펙으로 구체화한다.

## 권한 게이트 (P1)

로컬 bash와 remote_exec에 공통 적용되는 mu의 권한 모델.
pi에는 권한 시스템이 없다 (컨테이너 위임) — 이것이 mu 고유 가치의 절반.

### 원칙

1. **게이트는 코어 루프의 `beforeToolCall` 단일 지점에서만 동작한다.**
   정책 판정 로직을 코어 루프나 툴 구현에 하드코딩하지 않는다 (agent.ts 150줄 유지)
2. **판정 결과는 3레벨**: `allow` / `ask` / `deny`
3. **거부는 크래시가 아니라 정보.** ask에서 사용자가 거부하거나 deny로 차단되면
   사유를 에러 문자열로 모델에게 반환하고 루프는 계속된다
   (예: `Blocked by policy: ...`, `User declined to run this command`)

### 레벨 정의

| 레벨 | 동작 |
|------|------|
| `allow` | 자동 실행 |
| `ask` | 실행 전 사용자 확인. 무응답/거부 = 실행 안 함 |
| `deny` | 실행 차단, 차단 사유를 모델에게 반환 |

### 로컬 bash 정책

- 기본 `allow`. 위험 패턴만 `ask`: `rm -rf`, `sudo`, `git push --force`,
  `dd`, `chmod/chown -R`, `curl ... | sh` 류
- 시크릿 노출 위험은 `deny`: `~/.ssh/id_*`, `.env` 등의 cat/출력
- 패턴 목록은 코드가 아니라 설정 파일에 둔다 (프롬프트가 MU.md에 있는 것과 같은 이유)

### remote_exec 정책 — env 태그를 레벨로 매핑

| env | 레벨 | 추가 규칙 |
|-----|------|-----------|
| `dev` | `allow` | — |
| `staging` | `ask` | — |
| `prod` | `ask` (명시 승인) | **자동 연쇄 실행 금지** — 원격 출력 기반 후속 명령은 매번 승인 |

### 감사 로그

- 원격 명령뿐 아니라 **ask/deny 판정과 사용자 결정도 기록** (`시각/툴/명령/판정/결과`)

## remote_exec (P1) — 구현 완료

> 구현: `src/remote/hosts.ts`(레지스트리) + `src/tools/remoteExec.ts`(툴) +
> `gate.ts`의 env→레벨 판정. 레지스트리 파일 포맷은 **JSON(`hosts.json`)** 로 결정
> (policy.json·config.json과 일관, YAML 의존성 회피 — 미니멀 원칙).

### hosts.json — 호스트 레지스트리

```json
{
  "hosts": [
    { "alias": "api-dev",  "purpose": "API 개발 서버", "env": "dev" },
    { "alias": "api-prod", "purpose": "API 프로덕션",   "env": "prod",
      "ssh": "prod.example.internal" }
  ]
}
```

- `env`: `dev | staging | prod` — 권한 레벨을 결정 (아래 매핑).
- `ssh`(선택): 실제 `ssh`에 넘길 호스트(~/.ssh/config의 Host). 생략 시 `alias` 사용 —
  별칭과 ssh 호스트를 분리하고 싶을 때만.
- 기본 = 레포 `hosts.json`, 사용자 추가 = `~/.mu/hosts.json` (별칭 기준 병합, 사용자 우선).
- 실행은 `ssh -o BatchMode=yes -- <sshHost> <command>` 셸아웃 — ProxyJump·agent
  forwarding을 ~/.ssh/config에서 상속. dev는 세션 캐시 없이 자동, staging은 호스트별
  세션 허용, **prod는 매번 명시 승인**(세션 캐시 없음, 기본 포커스 '아니오').

### 원칙

1. **모델은 별칭만 본다.** SSH 키·시크릿은 절대 컨텍스트/코드/로그에 넣지 않는다.
   실제 인증은 로컬 ssh-agent + `~/.ssh/config`가 해결
2. **구현은 시스템 `ssh` 셸아웃.** ProxyJump, agent forwarding 등을 공짜로 상속
3. **환경 태그별 권한 게이트**: 위 "권한 게이트" 섹션의 env → 레벨 매핑을 따른다.
   prod의 연쇄 실행 금지는 원격 출력에 인젝션 위험이 있기 때문
   (출력 기반 후속 명령을 자동 실행하지 않음)
4. **감사 로그**: 모든 원격 명령을 `호스트/명령/시각/결과`로 로컬 기록

### 차별점 근거

Claude Code도 bash로 ssh를 칠 수 있지만, 호스트 레지스트리·환경 정책·감사라는
개념 자체가 없다. 이것이 mu가 존재하는 이유 중 절반.

## 스킬 시스템 (P2)

### 구조

- 스킬 = **팀 git 레포의 폴더** (`SKILL.md` + 선택적 스크립트)
- 배포 = `git pull`. 품질 관리 = PR 리뷰
- 런북·아키텍처 문서도 같은 레포에 두고 grep 검색 툴로 접근

### Lazy loading (Pi의 lazy skills 패턴)

- 컨텍스트에는 **스킬당 요약 한 줄**만 상주
- 실제 내용은 `load_skill` 툴로 필요할 때만 로드
- 목적: 컨텍스트 부풀림 방지 — harness가 컨텍스트를 낭비하면 모델이 일을 못 한다

### SKILL.md 최소 포맷 (초안)

```markdown
---
name: deploy-api
summary: API 서버 배포 절차 (한 줄 요약 — 이 줄만 상시 컨텍스트에 올라감)
---
(본문: 상세 절차, 주의사항, 스크립트 사용법)
```

### 검색

- 시작: grep/glob 기반 (충분함)
- 임베딩 검색: 실제로 필요해질 때만 추가 (미니멀 원칙)
