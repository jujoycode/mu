# 08. Claude Code 권한 모델 + ask UI 분석 → mu 적용 설계

> 결정 (2026-07-25): **권한 모델 계층과 ask 프롬프트 TUI는 Claude Code 구조를
> 거의 그대로 따라가고, 브랜드(색·문구·규모)만 mu에 맞게 변형한다.**
> 렌더링 스택은 **Ink(React for CLI) 도입**.
> 이 문서는 docs/05의 게이트 설계와 docs/07의 ask 프롬프트 절을 개정한다.

## 분석 소스와 법적 경계

- 분석 대상: `yasasbanukaofficial/claude-code` — 2026-03-31 npm sourcemap 사고로
  유출된 Claude Code 원본 소스의 미러. 배포된 `.tsx`는 React Compiler 변환본이지만
  각 파일 말미 인라인 sourcemap의 `sourcesContent`에 클린 원본이 들어 있다.
- ⚠️ 원본 코드는 Anthropic 독점 저작물. **코드 복사는 하지 않는다.**
  타입 구조·판정 순서·UX 규약·수치(색상, 키 배치)를 참고해 전부 자체 구현한다.
  (아이디어/구조는 저작권 보호 대상이 아니지만, 표현(코드)은 보호 대상이라는 경계.)

---

# PART 1 — 권한 모델 계층 (Claude Code 구조 채택)

## 1.1 핵심 타입 (mu `src/gate.ts` 개정 목표)

Claude Code의 권한 모델은 4개 개념으로 구성된다. mu는 이 구조를 그대로 채택한다.

**Behavior** — 3값. mu 기존 설계와 동일.

```
behavior := 'allow' | 'deny' | 'ask'
```

**Rule** — "어떤 툴의 어떤 내용을" + "어디서 온 규칙인지".

```
RuleValue = { toolName: string, ruleContent?: string }
Rule      = { source: RuleSource, behavior: Behavior, value: RuleValue }
```

- 직렬화 형식은 `ToolName(content)` 문자열: `bash(npm run:*)`, `bash(rm -rf:*)`,
  content 없으면 툴 전체: `bash`. 괄호는 `\(` 이스케이프.
- `:*` 접미사 = 프리픽스 매칭 (mu 기존 게이트의 프리픽스 매칭과 호환).

**Source(규칙 출처) 계층** — Claude Code는 8단계, mu는 4단계로 축소:

| Claude Code | mu | 저장 위치 |
|-------------|-----|----------|
| `policySettings` (관리자 강제) | — (스킵) | |
| `userSettings` | `user` | `~/.mu/policy.json` |
| `projectSettings` | `project` | 레포 `policy.json` |
| `localSettings` | — (P2에 필요시) | |
| `cliArg` / `flagSettings` | `cliArg` | `--allow`, `--deny` 플래그 |
| `session` | `session` | 메모리 (ask 다이얼로그에서 추가된 규칙) |
| `command` | — | |

**Decision(판정 결과)** — 판정은 behavior에 **근거(reason)와 제안(suggestions)**을 붙여 반환:

```
Decision =
  | { behavior: 'allow', reason }
  | { behavior: 'deny',  reason, message }        // 모델에 돌려줄 메시지
  | { behavior: 'ask',   reason, suggestions? }   // UI가 don't-ask-again 후보로 표시
reason = { type: 'rule', rule } | { type: 'mode', mode } | { type: 'other', text }
```

`suggestions`가 권한 모델과 UI의 연결점이다: 게이트가 "이 규칙을 저장하면 다음부턴
안 물어봄" 후보(`bash(npm run:*)` 등)를 만들어 ask Decision에 실어 보내고,
다이얼로그는 그걸 편집 가능한 입력으로 보여준다.

**Update(규칙 변경)** — UI가 사용자의 선택을 게이트에 되돌려주는 연산:

```
Update = { type: 'addRules', rules: RuleValue[], behavior, destination }
destination := 'user' | 'project' | 'session'
```

Claude Code는 6종(add/replace/remove/setMode/addDirectories/removeDirectories)이지만
mu는 **`addRules` 하나로 시작**한다. 나머지는 필요해질 때 추가.

## 1.2 판정 순서 (Claude Code 순서 그대로)

Claude Code `permissions.ts`에서 확인한 순서를 채택한다. **deny가 항상 이긴다.**

```
1. 툴 전체 deny 규칙        → deny (즉시 종료)
2. 툴 전체 ask 규칙         → ask
3. 툴별 내용 검사            → bash: 명령 파싱 후 프리픽스 규칙 매칭
   3a. 내용 deny 매칭       → deny
   3b. 내용 ask 매칭        → ask
4. 모드 검사                → bypass 모드면 allow
5. 내용 allow 매칭          → allow
6. 기본값                   → ask (fail-safe)
```

- 복합 명령(`a && b`)은 서브커맨드로 쪼개 **각각 판정 후 가장 엄격한 결과** 채택
  (mu 기존 게이트 동작 유지 — Claude Code의 `subcommandResults`와 같은 의미).
- 규칙 출처 간 우선순위: 같은 behavior끼리는 출처 무관 동일 효력.
  behavior 간에는 deny > ask > allow. (add-only 병합 규약 유지 — docs/05)

## 1.3 모드 (축소 채택)

Claude Code의 5모드(default/acceptEdits/plan/bypassPermissions/dontAsk) 중
mu는 2개만: **`default`** / **`bypass`**(`--yolo` 플래그, CI·신뢰 환경용).
plan 모드·acceptEdits는 mu 로드맵에 없음. 비대화형(`-p`)에서 ask = 자동 deny (기존 규약).

## 1.4 mu 기존 gate.ts에서 바뀌는 것

| 현재 (P1 구현) | 개정 후 |
|----------------|---------|
| `check() → 'allow'│'ask'│'deny'` 문자열 | `check() → Decision` (reason + suggestions 포함) |
| policy.json flat 목록 | 동일 파일, 규칙 문자열을 `RuleValue`로 파싱 |
| ask 시 비대화형 차단만 | ask 시 `askUser(decision)` TUI 호출 |
| 정책 변경 수단 없음 | `applyUpdate(update)` — user/project/session별 저장 |
| 감사 로그: 판정만 기록 | Decision.reason까지 기록 (왜 허용/차단됐는지) |

---

# PART 2 — ask 프롬프트 TUI (Claude Code 스타일, mu 브랜딩)

## 2.1 레이어링 (5층 구조 그대로 채택)

| 층 | Claude Code | mu 파일 | 역할 |
|----|-------------|---------|------|
| 라우터 | `PermissionRequest` | `src/tui/ask/index.tsx` | 툴 종류 → 전용 다이얼로그 (bash / remote_exec / fallback) |
| 프레임 | `PermissionDialog` + `Title` | `src/tui/ask/Dialog.tsx` | 상단 보더 + 제목 + 부제목 |
| 질문+옵션 | `PermissionPrompt` | `src/tui/ask/Prompt.tsx` | 질문 문구, 옵션 변환, Tab 피드백 상태 |
| 리스트 | `Select` (CustomSelect) | `src/tui/Select.tsx` | 키 내비게이션, input형 옵션 지원 |
| 행 | `ListItem` | `src/tui/ListItem.tsx` | `❯`/`✓`/`↑↓` 인디케이터 + 상태색 |

라우터를 포함해 **계층을 그대로 유지**한다 (P1은 bash + fallback 2종으로 시작,
P1 후반 remote_exec 추가). Select/ListItem은 ask 전용이 아닌 범용 컴포넌트로 두어
이후 REPL의 다른 선택 UI(모델 선택 등)에서 재사용.

## 2.2 비주얼 문법

- 다이얼로그는 풀 박스가 아니라 **위쪽 라운드 보더 한 줄만** (left/right/bottom 없음,
  위 여백 1줄). 터미널 스크롤백 친화 — pi의 append-only 철학과도 일치.
- 제목 bold + `permission` 색. 부제목(명령어)은 dim, 길면 **앞쪽을 truncate**
  (뒤쪽이 위험한 인자를 담는 경우가 많으므로).
- 옵션 행 인디케이터: 포커스 `❯` + `accent` / 확정 `✓` + `success` /
  리스트 잘림 `↑`·`↓` dim. description은 라벨 아래 들여쓰기 2 + `muted`.

```
 ────────────────────────────────────────────
 bash 실행 요청                        ← bold, permission
 rm -rf ./build                        ← dim
   계속할까요?
 ❯ 예
   예, 다음부턴 묻지 않기: rm -rf:*    ← 편집 가능 입력
   아니오
 ↑↓ 이동 · ⏎ 선택 · tab 피드백 · esc 거부   ← dim 키 힌트
```

키 힌트 줄은 Claude Code에 없지만(footer가 대신함) mu는 P1에 footer가 없으므로 추가.

## 2.3 인터랙션 규약 (그대로 채택)

1. **3-way 옵션**: `예` / `예, 다음부턴 묻지 않기: <규칙>` / `아니오`.
   - don't-ask-again 라벨은 **규칙 내용이 편집 가능한 인라인 입력**
     (Claude Code Bash 다이얼로그의 editable prefix 방식). 초깃값은 게이트
     `suggestions`의 첫 규칙 = 명령 첫 단어 + `:*` (LLM 제안 호출은 두지 않음).
   - 저장 destination은 기본 `user`(`~/.mu/policy.json`). 프로젝트 정책은
     수동 편집 원칙 유지 (팀 공유 파일을 다이얼로그에서 오염시키지 않기).
2. **Tab = 인라인 피드백 확장** (시그니처 UX):
   - `예` 포커스 + Tab → "…하고 다음엔 이렇게 해줘" 입력창으로 변신
   - `아니오` 포커스 + Tab → "…말고 이렇게 해줘" 입력창
   - 빈 입력 제출 = 입력 모드 취소 복귀. 피드백은 툴 결과에 합쳐 다음 턴에 전달
     (거부 시 `사용자 거부: <feedback>` — docs/05 게이트 규약 확장).
3. **Esc = 거부** (안전 기본값). Ctrl+C도 동일.
4. **prod 대상 remote_exec은 기본 포커스를 `아니오`에** (docs/07 규칙 유지).
5. Claude Code의 자동 승인 분류기 shimmer("Attempting to auto-approve…"),
   사용자 조작 시 자동 해제 중단 규약은 **분류기 없는 mu엔 해당 없음** — 기록만.

## 2.4 색 토큰 — 실측값과 mu 브랜딩

Claude Code 다크 테마 실측값 (참고 기준):

| 토큰 | RGB | 용도 |
|------|-----|------|
| `permission` / `suggestion` | 87,105,247 (보라-파랑) | 다이얼로그 보더·제목, 포커스 행 |
| `success` | 44,122,57 | `✓` 확정 |
| `inactive` | 102,102,102 | description·비활성 |
| `subtle` | 175,175,175 | 보조 텍스트 |
| `claude` | 215,119,87 (브랜드 오렌지) | 브랜드 강조 |

**mu 브랜딩 변형**: 구조는 유지하고 값만 교체한다.

- `claude` 오렌지 → **mu `accent`** (무채색 계열 제안: 無의 미니멀리즘.
  최종 값은 도그푸딩하며 결정, 우선 `permission`과 동일 계열로 시작)
- `permission`/`suggestion`은 파랑 계열 유지 (승인 UI = 파랑 관례가 인지에 유리)
- ANSI 16색 폴백 세트도 함께 정의: permission→blue, success→green, inactive→blackBright
- docs/07의 15토큰 테마셋에 `permission` 1개만 추가하면 됨

## 2.5 렌더링 스택: Ink 도입 (docs/07 개정)

- ask 프롬프트를 포함한 **인터랙티브 표면 전체를 Ink로 구현**한다.
  docs/07의 "pi 코어 ~2,500줄 이식" 계획을 대체.
- 근거: 포커스 관리·인라인 입력 전환·부분 리렌더를 Ink가 제공. Claude Code 자체가
  Ink 기반이므로 계층 구조를 따라가기에 가장 자연스럽고, 자체 diff 렌더러
  이식(~700줄)보다 총비용이 낮다. Bun 호환 확인됨 (Claude Code가 Bun 빌드).
- 의존성 추가: `ink`, `react`, `figures`. 미니멀리즘 위반이 아니냐는 반론에 대해:
  mu의 미니멀리즘은 "코어 루프와 도구의 단순함"이지 NIH가 아니다 (docs/02 원칙).
- pi에서 가져오기로 한 나머지 비주얼 문법(툴콜 카드, diff 프리뷰, footer)은
  유효하며 Ink 컴포넌트로 재구현한다.

## 2.6 게이트 ↔ TUI 연결 계약

```
agent 루프:
  decision = gate.check(toolCall)
  if decision.behavior == 'ask':
      result = await askUser(decision)          // Ink 다이얼로그
      switch result.kind:
        'allow-once'   → 실행 (+feedback 전달)
        'allow-always' → gate.applyUpdate({addRules, destination}) → 실행
        'deny'         → 모델에 거부 메시지 (+feedback) 반환
  감사 로그: decision.reason + 사용자 선택 기록
```

`askUser`는 Promise 반환 — 다이얼로그가 입력 에디터 자리를 교체하고, 완료 후 복귀
(docs/07의 selector 패턴과 동일한 흐름을 Ink로).

---

# PART 3 — 브랜드 표면: 마스코트 + 스피너 (구조 채택, 디자인은 mu 오리지널)

Claude Code의 "성격"을 만드는 두 요소. 구조와 애니메이션 기법은 따라가되,
**캐릭터 디자인과 멘트 목록은 mu 오리지널로 만든다** (이 둘이야말로 브랜드 그 자체라
복제하면 안 되는 영역이고, 바꿔야 재미가 산다).

## 3.1 마스코트 — Clawd 분석

Claude Code의 시그니처
