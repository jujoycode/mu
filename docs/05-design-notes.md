# 05. 설계 초안 — remote_exec & 스킬 시스템

> P1/P2 진입 시 이 문서를 스펙으로 구체화한다.

## remote_exec (P1)

### hosts.yaml — 호스트 레지스트리

```yaml
hosts:
  - alias: api-dev
    purpose: "API 개발 서버"
    env: dev          # dev | staging | prod
  - alias: api-prod
    purpose: "API 프로덕션"
    env: prod
```

### 원칙

1. **모델은 별칭만 본다.** SSH 키·시크릿은 절대 컨텍스트/코드/로그에 넣지 않는다.
   실제 인증은 로컬 ssh-agent + `~/.ssh/config`가 해결
2. **구현은 시스템 `ssh` 셸아웃.** ProxyJump, agent forwarding 등을 공짜로 상속
3. **환경 태그별 권한 게이트**:
   - `dev` → 자동 허용
   - `staging` → 실행 전 사용자 확인
   - `prod` → 명시적 승인 필수 + **자동 연쇄 실행 금지**
     (원격 출력에 인젝션 위험이 있으므로 prod에선 출력 기반 후속 명령을 자동 실행하지 않음)
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
