# 09. 마스코트 캐릭터 + 스피너 멘트 (브랜드 감성)

> 결정 (2026-07-25): Claude Code의 두 브랜드 감성 요소 — ① 상단에 상주하는
> 시그니처 캐릭터, ② 응답 중 도는 스피너의 랜덤 멘트 — 를 **구조·연출은 따라가고,
> 캐릭터 디자인과 멘트 목록은 mu(無/μ) 정체성으로 새로 만든다.**
> 렌더링은 docs/08과 동일하게 Ink. 원본 코드·아트·멘트는 복사하지 않는다 (docs/08 경계).

## 왜 이 두 가지인가

기능이 아니라 **감성**을 담당하는 요소다. 캐릭터는 "이 도구엔 인격이 있다"는
인상을, 랜덤 스피너 멘트는 "기다림"을 놀이로 바꾼다. mu 같은 내부 도구일수록
매일 쓰는 사람의 애착을 만드는 이 레이어가 채택률(도그푸딩, docs/04 P3)에 직결된다.

---

# PART 1 — 마스코트 캐릭터

## 1.1 Claude Code 관찰 결과 ("Clawd")

- 정체: **유니코드 블록 문자로 그린 게(crab) 캐릭터**, 3행 고정 높이.
  `src/components/LogoV2/Clawd.tsx` — 예: `▛███▜` / `▛█████▜` / ` ▘▘ ▝▝ `.
  본체색 `clawd_body`(오렌지 `rgb(215,119,87)`), 눈 부분만 배경색 트릭.
- **4개 포즈**: `default` / `arms-up`(점프) / `look-left` / `look-right`(눈동자 이동).
  각 포즈는 바뀌는 세그먼트(눈·팔)만 교체하고 몸통·배경은 고정 → 9칸 폭 유지.
- **애니메이션** (`AnimatedClawd.tsx`): 프레임 배열을 60ms 간격으로 재생.
  - `JUMP_WAVE`: 웅크림 2f → arms-up 3f → 복귀, 2회 (marginTop offset으로 통통 튐)
  - `LOOK_AROUND`: 오른쪽 5f → 왼쪽 5f → 정면
  - **클릭하면** 두 시퀀스 중 랜덤 재생 (상호작용성). 평소엔 idle.
- 터미널 호환: Apple Terminal은 문자 간 세로 여백을 렌더 못 해서 배경색으로
  실루엣을 그리는 별도 폴백 컴포넌트. reduced-motion이면 애니메이션 정지.
- 등장 위치: 웰컴 로고(`LogoV2`)와 축약 로고(`CondensedLogo`) — 세션 상단에 상주.

## 1.2 mu 적용 설계

**디자인 방향**: 게를 베끼지 않는다. mu = **無(선불교 공안) + μ(마이크로)**.

> **결정 (2026-07-25): 기본 마스코트는 엔소(円相). 단, 특정 캐릭터에 고정하지
> 않고 마스코트를 데이터로 정의해 레지스트리에서 골라 쓰는 구조로 구현한다.**
> 교체·추가가 쉬워야 하고, 여러 마스코트를 바꿔가며 쓸 수 있어야 한다 (팀 취향
> 반영 + 도그푸딩 때 후보 추가 실험).

구현 (`src/tui/mascot.ts` — 순수 데이터, Ink 비의존):
- `Mascot` = `{ name, width, height, poses, animations }`.
  포즈는 고정 크기 행 문자열 배열, 애니메이션은 `{pose, offset}[]` 프레임 시퀀스
  (`hold()` 헬퍼, 재생 간격 60ms는 렌더러 몫) — Clawd의 세그먼트/Frame 구조 채택.
- **레지스트리** `MASCOTS`: 현재 `enso`(기본) + `dot`(극단 미니멀 대안).
  새 마스코트 = 항목 하나 추가가 전부. μ 의인화 등 후보는 도그푸딩 때 추가.
- **전환**: `~/.mu/config.json`의 `{"mascot": "dot"}` (없거나 깨지면 조용히 기본값,
  `MU_CONFIG_DIR`로 테스트 오버라이드 — session.ts의 `MU_SESSION_DIR` 패턴).
  P1 후반에 `/mascot` 명령으로 런타임 전환 추가 검토.
- 엔소 아트: 우상단이 열린 원 + μ 서명. 포즈 `default`/`blink`/`void`(비움=無) +
  웰컴용 붓획 `stroke-1`→`stroke-2`→`void`→`default` (greet 애니메이션).
  무채색 계열(mu accent)로 Clawd의 오렌지와 차별화.
- 렌더 컴포넌트(`AnimatedMascot`, 클릭 시 랜덤 시퀀스)는 Ink 도입(docs/08)과 함께.
  reduced-motion·비대화형(`-p`)에서는 정적 1프레임.
- 터미널 호환 폴백은 P2로 미룸 (초기엔 표준 터미널만, 깨지면 정적 fallback).

**등장 위치**: 웰컴 배너(세션 시작) + footer 좌측에 축약형 1행.
docs/07 footer 규약과 통합.

---

# PART 2 — 스피너 + 랜덤 멘트

## 2.1 Claude Code 관찰 결과

- **글리프**: `✻`(teardrop asterisk) 계열 6프레임 —
  `['·','✢','✳','✶','✻','✽']` (플랫폼별 미세 차이: Ghostty·Linux는 `✳`→`*`).
  정방향 + 역방향을 이어 붙여 왕복 재생, `useAnimationFrame(50)` = 50ms/프레임.
- **멘트**: `src/constants/spinnerVerbs.ts`에 **동사 188개** 배열
  (`Accomplishing`, `Baking`, `Bamboozling`, `Cerebrating`, `Clauding`,
  `Reticulating`, `Vibing`, `Wrangling` …). 위트·요리·물리·춤 계열이 섞임.
  - **마운트 시 `sample()`로 1개 랜덤 고정** → 한 턴 내내 같은 동사, `동사…` 표기.
  - 사용자 설정으로 `replace`(교체) 또는 append(추가) 가능.
- **상태 연출**:
  - 3초간 새 토큰이 안 오면 스피너색을 **빨강으로 부드럽게 보간**(stall 신호,
    `useStalledAnimation`).
  - 30초 넘으면 토큰 수·경과시간 등 부가 정보를 ` · ` 구분자로 뒤에 붙임.
  - `thinking` 상태는 별도 shimmer(반짝임) 텍스트.
  - reduced-motion이면 2초 주기로 깜빡이는 점 `●` 하나로 대체.

## 2.2 mu 적용 설계

**글리프**: `✻` 계열 6프레임 왕복은 그대로 채택 (유니코드 표준 문자라 저작권 무관,
플랫폼 폴백 로직도 동일하게). 50ms 재생.

**멘트 목록 — mu 자체 작성** (원본 188개 복사 금지). 큐레이션 원칙:
- mu 정체성 반영: 禪·無·미니멀 유머 한 스푼 (예: `無爲中`, `Contemplating`,
  `Distilling`, `Subtracting`, `Vibing`) — **한국어/영어 혼용 가능** (내부 팀 도구).
- 팀 인사이드 조크를 넣을 자리 (docs/04 P3 도그푸딩 때 팀이 PR로 추가).
- 규모는 40~60개로 시작 (188개는 과함, 자체 채움이 부담). 부족하면 팀이 채운다.
- **팀 커스터마이즈 훅**: Claude Code처럼 설정으로 replace/append 지원 —
  `~/.mu/config.json`의 `spinnerVerbs: { mode: 'append', verbs: [...] }`.
  개인이 자기 멘트를 얹을 수 있게 (애착 포인트).

**구조**:
- `src/tui/spinner/verbs.ts` — 멘트 배열 + `getSpinnerVerbs()`(설정 병합)
- `src/tui/spinner/Spinner.tsx` — 글리프 프레임 + 마운트 시 `sample` 1회 고정 +
  `동사…` 렌더. stall(빨강 보간)·경과시간 부가정보는 P1 후반, thinking shimmer는 P2.
- reduced-motion 폴백(깜빡이는 점)은 접근성 위해 P1에 포함.

## 2.3 단계 배치

| 단계 | 작업 |
|------|------|
| P1 | 스피너 글리프 6프레임 + 랜덤 멘트(자체 40~60개) + reduced-motion 폴백 · 웰컴 배너 마스코트(정적 or 1애니메이션) |
| P1 후반 | 마스코트 클릭 상호작용 + footer 축약형, 스피너 stall-red·경과시간 |
| P2 | 터미널 호환 폴백, thinking shimmer, 팀 멘트 확장(도그푸딩) |

## 2.4 설계 원칙 확인

- 이 레이어는 **코어 루프에 비침습** (docs/03) — 순수 표시 컴포넌트. 없어도 mu는 돈다.
- 미니멀리즘 위반 아님: 멘트 배열은 데이터 파일 1개, 마스코트는 아트 상수.
  코어의 단순함(docs/02)과 무관한 "브랜드 표면"이다.
- 원본 자산(Clawd 아트·188개 멘트)은 Anthropic 것 — **연출 방식만 배우고 mu 것으로 채운다.**
