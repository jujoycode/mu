# 06. pi 소스 분석 — 아키텍처 레퍼런스

> 분석 대상: [earendil-works/pi](https://github.com/earendil-works/pi) (MIT, Mario Zechner / Earendil)
> 스냅샷: v0.82.0, commit `24e5cc0` · 분석일: 2026-07-24
> 목적: mu P0–P2 구현 시 코드 레벨 참조. 파일 경로는 pi 레포 기준.

## 전체 구조

| 패키지 | 내용 | 규모 | mu 대응 |
|---|---|---|---|
| `packages/agent` | 에이전트 루프 + 하네스 | ~10k줄 | `src/agent.ts`의 참조 원본 |
| `packages/ai` | 멀티 프로바이더 LLM API | ~21k줄 | `src/llm.ts`가 1/100로 축소할 대상 |
| `packages/coding-agent` | CLI 본체, 툴, 스킬, 세션 | ~55k줄 | `src/cli.ts` + `src/tools/` |
| `packages/tui` | 차분 렌더링 터미널 UI | ~12k줄 | 스킵 (mu는 최소 REPL) |

pi에는 권한 시스템이 의도적으로 없다 (샌드박싱은 컨테이너에 위임).
mu의 환경별 권한 게이트(dev/staging/prod)는 pi에 없는 mu 고유 가치.

---

## 1. 코어 루프 (`packages/agent/src/agent-loop.ts`, 792줄)

루프 본체는 `runLoop` 함수 하나(155–275행). 클래스가 아니라 순수 함수.
steering/follow-up 큐를 제거하면 핵심은 ~30줄로 압축된다:

```
while (마지막 응답에 toolCall 있음 || 주입할 메시지 있음):
  message = LLM 스트리밍 → messages에 append
  if stopReason == error/aborted → 종료
  toolCalls = message.content에서 필터
  toolResults = 툴 실행 → messages에 append
```

**종료 조건은 단 하나: "tool call 없는 assistant 응답 = 자연 종료."**
별도 max-iteration 카운터 없음. mu의 150줄 목표에 정확히 부합.

### 가져갈 설계

- **truncation 방어** (208–214행): `stopReason === "length"`(출력 잘림)이면 그 턴의
  tool call은 인자 JSON이 잘렸을 수 있으므로 실행하지 않고 전부 에러 결과로 반환
  → 모델이 재발행. 잘린 인자로 인한 파괴적 실행 방지.
- **`EventStream` 프리미티브** (`packages/ai/src/utils/event-stream.ts`, 89줄):
  async iterable + 완료 이벤트에서 최종 결과를 뽑는 promise. 통째로 이식할 가치.
- **StreamFn 계약: 실패는 예외가 아니라 데이터.** LLM 호출 실패도 throw하지 않고
  최종 메시지의 `stopReason: "error"` + `errorMessage`로 인코딩 → 루프는
  `if (stopReason === "error")` 분기 하나로 끝난다.
- **전송/저장 표현 분리**: 루프는 리치한 `AgentMessage[]`로 돌고, LLM 호출 경계에서
  `convertToLlm` 단일 지점으로만 API 포맷 변환.
- **스트리밍 UI 패턴**: 델타마다 partial 메시지를 배열 마지막 슬롯에 덮어쓰고
  `message_update` 이벤트 emit.
- **병렬 툴 실행 + 순서 보존** (489–554행): execute는 `Promise.all`, 결과 메시지는
  원래 순서로 emit. P1에서 필요해지면 참고.

### 상태 모델

저수준 컨텍스트는 `{ systemPrompt, messages, tools }`가 전부 (`types.ts:405-413`).
`isStreaming`, `pendingToolCalls` 같은 파생 상태는 저장하지 않고 이벤트 리듀서로
재구성. **mu의 "messages 배열 = 유일한 상태" 원칙이 pi에서 실증됨.**

### 버릴 것

- 하네스 레이어 전체 (`harness/`, agent-harness.ts만 1084줄): hook 이벤트 시스템,
  툴 컨텍스트 커링, `ExecutionEnv` 파일시스템 추상화(크로스 백엔드용)
- 확장 콜백 9종 중 초기 mu에 필요한 건 `beforeToolCall`(권한 게이트 자리) +
  관찰용 `onEvent` 둘뿐. steering/follow-up/`prepareNextTurn`은 스킵

### 에러 처리 — mu 규약과의 차이 (중요)

pi의 규약은 mu와 반대 방향이다: **툴은 실패 시 throw하고, 루프가 catch해서
에러 문자열 tool result로 변환한다** (`agent-loop.ts:697-706`). 모델이 최종적으로
받는 것(에러 텍스트 + `isError: true`)은 mu 설계와 동일.

pi 방식의 장점: 스키마 검증 실패, 툴 미발견, 예상 못 한 런타임 에러까지
**모든 실패 경로가 루프의 단일 catch로 수렴**한다.

**mu 결정: "툴은 에러 문자열 반환, throw 금지" 규약은 유지하되,
루프 레벨에 방어적 try/catch를 추가한다.** 규약 위반 툴이나 검증 에러가
루프 전체를 죽이지 않도록. (CLAUDE.md 절대 규칙과 충돌 없음 — 안전망일 뿐)

---

## 2. LLM 레이어 (`packages/ai`)

### pi가 하는 일

- 공식 `@anthropic-ai/sdk`를 쓰되 **SDK의 스트리밍 헬퍼는 안 쓴다.**
  `client.messages.create({stream: true}).asResponse()`로 raw Response를 받아
  자체 SSE 파서(~190줄)로 소비. 이유: SDK 내장 재시도가 AbortSignal을 무시해서
  `maxRetries: 0` + 자체 abortable 재시도로 감싸기 위함.
- 스트림 이벤트를 프로바이더 중립 이벤트(`text_delta`/`toolcall_delta`/`done`/`error`)로
  정규화. tool_use 인자는 `input_json_delta`를 `partialJson`에 누적 후 파싱.
- 실패는 스트림 안에 `stopReason: "error"`로 인코딩 (throw 금지 계약).
- usage는 `message_start`(조기 abort 대비)와 `message_delta`(최종) 2지점에서 캡처.

### mu의 `llm.ts`에 필요한 5조각

1. 코어 타입: `Message`(user/assistant/toolResult 3-role), `TextContent`/`ToolCall`, `Usage`
2. 메시지 변환: 내부 포맷 → Anthropic params (toolResult는 user role의 `tool_result` 블록)
3. 스트림 이벤트 조립: tool_use 델타 누적 + 최종 `JSON.parse`
4. usage 캡처 (2지점 합산 — Anthropic은 `total_tokens`를 안 줌)
5. stop_reason 매핑: `end_turn/max_tokens/tool_use/refusal` 4종이면 충분

**SSE 소비와 재시도는 pi 방식을 그대로 따른다.** pi가 SDK 스트리밍 헬퍼를 버린
이유(내장 재시도가 AbortSignal을 무시 → 취소해도 백오프 타이머가 계속 돎)는
단일 프로바이더인 mu에도 그대로 해당된다. 따라서:
- `client.messages.create({stream: true}, {maxRetries: 0}).asResponse()`로 raw Response
- 자체 SSE 라인 파싱 (pi `anthropic-messages.ts:295-444` 참조)
- abortable 백오프 재시도 (pi `provider-retry.ts` 참조 — `retry-after` 헤더 우선,
  없으면 지수 백오프 + jitter, 408/409/429/5xx 대상)
- `message_start`는 봤는데 `message_stop` 없이 끝나면 잘린 스트림으로 판정해 재시도

단일 프로바이더이므로 pi의 해당 코드(~300줄)보다 작게 유지할 수 있다.

### 통째로 스킵할 것

멀티 프로바이더 레지스트리, `compat` 플래그 시스템(모델별 기능 분기 — 단일 모델이면
전부 상수), OAuth/Claude Code stealth 모드, Copilot/Bedrock/z.ai 분기,
20+ 프로바이더 대응 컨텍스트 초과 정규식(`overflow.ts` — Anthropic 패턴 1개면 됨),
thinking budget/adaptive 이중 경로.

캐시는 system 블록 + 마지막 user 메시지에 `cache_control: {type: "ephemeral"}`
하드코딩 정도로 시작.

---

## 3. 툴 (`packages/coding-agent/src/core/tools/`)

**pi의 "coding tools"는 정확히 read / bash / edit / write 4개다**
(`index.ts:138-145`). mu의 4-툴 계획과 일치. grep/find/ls는 별도 read-only
툴셋이고, bash description에 "ls, grep, find, etc."로 bash 대체를 명시한다.

공통 truncation 정책: **2000줄 / 50KB 중 먼저 걸리는 쪽** (`truncate.ts`).

### 툴별 핵심 (mu가 verbatim 복사할 것 위주)

**read** — head truncation + 연속 힌트. 잘리면
`[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]` 반환.
"다음에 뭘 하라"는 힌트가 모델 루프를 매끄럽게 하는 핵심.

**write** — 부모 디렉토리 자동 생성, 성공 시 `Successfully wrote N bytes to path`.

**edit** — 성공률의 핵심. 그대로 가져올 것:
- **exact → fuzzy 2단계 매칭**: `indexOf` 실패 시 NFKC 정규화 + trailing whitespace
  제거 + 스마트 따옴표/대시/특수 공백 정규화 후 재검색 (`edit-diff.ts:33-54`)
- BOM strip, CRLF→LF 정규화 후 편집, 저장 시 원래 EOL 복원
- 다중 edit는 원본 기준 각각 매칭(순차 적용 아님) + 역순 적용 + overlap 검사
- 중복 발생 시 거부: `Found N occurrences ... Please provide more context to make it unique.`
- 에러 문구가 곧 모델 자가수정 프롬프트:
  `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`

**bash** — 최소 안전장치:
- 타임아웃 옵션 + **프로세스 트리 kill** (detached spawn — 고아 프로세스 방지)
- stdout+stderr 병합, **tail truncation** (에러/최종 결과는 끝에 있으므로 head가 아닌
  마지막 2000줄/50KB 유지), 초과분은 temp 파일에 저장하고 경로 안내
- exit code 비0 → 출력 뒤에 `Command exited with code N` append해서 에러 반환

### 스키마

pi는 TypeBox(`parameters` 필드) + `Value.Convert` coercion(문자열→숫자 등) 후 검증.
mu는 `inputSchema` 명명으로 JSON Schema 직접 사용 가능하되, **coercion은 유지 권장**
(모델이 숫자를 문자열로 보내는 일이 실제로 잦음). edit의 `prepareArguments` shim
(edits가 JSON 문자열로 오면 파싱)도 실모델 대응에 유용.

### 스킵

`ReadOperations` 등 원격 위임용 추상화(mu의 remote_exec는 별도 툴이므로 불필요),
이미지 읽기/리사이즈, `file-mutation-queue`(순차 실행이면 불필요), macOS 경로
특수 케이스, TUI 렌더러 메타.

---

## 4. 스킬 시스템

### pi의 lazy loading 실제 메커니즘

**pi에는 `load_skill` 툴이 없다.** 시작 시 name+description만 파싱해서
시스템 프롬프트에 XML로 주입하고, 전체 내용은 **모델이 read 툴로
`<location>` 경로를 알아서 읽게** 유도한다:

```xml
<available_skills>
  <skill>
    <name>brave-search</name>
    <description>...</description>
    <location>/abs/path/SKILL.md</location>
  </skill>
</available_skills>
```

그리고 pi 문서 스스로 인정한다: *"models don't always do this"* — 모델이 종종
안 읽어서 `/skill:name` 강제 주입 경로를 따로 둔다 (`agent-session.ts:1301-1325`).

**mu 결정: 계획대로 명시적 `load_skill` 툴로 간다.** pi의 방식보다 신뢰성이 높고,
"읽었는지"가 tool call 로그에 남는다. 요약 주입은 pi의 XML 블록 포맷 차용.

### SKILL.md frontmatter

`name`(최대 64자, `^[a-z0-9-]+$`) + `description`(최대 1024자) 2개가 사실상 전부.
description 없으면 로드 자체를 거부(유일한 하드 실패), 나머지 위반은 warning만.
이름 충돌은 first-wins. → mu의 docs/05 초안(`name` + `summary`)과 거의 일치.
mu는 단일 팀 스킬 레포이므로 pi의 5중 발견 경로(global/project/package/settings/CLI)는
불필요 — 디렉토리 하나 스캔이면 된다.

---

## 5. 시스템 프롬프트

pi도 프롬프트 외부 파일 오버라이드를 지원한다: `.pi/SYSTEM.md`(프로젝트) →
`~/.pi/agent/SYSTEM.md`(글로벌) → 하드코딩 기본값 순 (`resource-loader.ts:966-978`).
**mu의 MU.md는 이 SYSTEM.md와 같은 개념이되 더 순수** — mu는 하드코딩 fallback
없이 MU.md 부재 시 에러로 처리한다.

참고할 디테일:
- AGENTS.md/CLAUDE.md는 시스템 프롬프트가 아니라 별도 `<project_context>` 블록으로
  경로와 함께 첨부 (`<project_instructions path="...">`)
- cwd를 프롬프트 마지막에 append
- 스킬 요약 주입은 read 툴(mu는 load_skill)이 활성일 때만

---

## 6. 세션 저장

pi는 **append-only JSONL 트리**를 쓴다: 한 줄 = 한 엔트리, `id`/`parentId`로
브랜칭/fork/compaction 표현. 저장은 매 메시지마다 `appendFileSync` 한 줄
(`session-manager.ts:1015-1042`). 저장 위치는 `~/.pi/agent/sessions/--<cwd인코딩>--/<timestamp>_<uuid>.jsonl`.

**mu 조정 제안: "messages 배열 JSON dump"의 구현을 선형 JSONL append로 한다.**
- 진실은 여전히 메시지 시퀀스 하나 — 원칙("messages = 유일한 상태")은 그대로
- 매 메시지 한 줄 append → 크래시 시 진행분 보존, 전체 재직렬화 불필요
- 트리/브랜칭/fork/버전 마이그레이션은 스킵 (pi 복잡도의 대부분이 여기)

**compaction**: pi는 임계 토큰 초과 시 오래된 메시지를 LLM으로 구조화 요약
(Goal/Progress/Next Steps 고정 포맷) 후 최근 메시지만 유지한다. mu 로드맵에는
없지만 긴 세션에선 사실상 필수 — P1 백로그로 등재하고, 최소 버전
("임계 초과 시 1회 요약 + 이후 유지")으로 단순화한다.

---

## 7. 확장 시스템 (P2 이후 참고)

pi 확장은 default export 팩토리 함수 하나가 `ExtensionAPI`를 받는 구조.
jiti로 TS를 무컴파일 로드. 30+개 이벤트, provider 등록, TUI 컴포넌트까지 지원.

mu 초기엔 확장 시스템 자체가 불필요하다 (스킬 = 데이터로 충분). P2에서
필요해지면 최소 조합만: `tool_call`(block — 권한 게이트), `before_agent_start`
(컨텍스트 주입), `registerTool`. 참고 예제: `examples/extensions/protected-paths.ts`
(30줄로 위험 경로 쓰기 차단 — mu 권한 게이트의 좋은 스케치).

---

## 8. mu 설계에 대한 결론

### 재확인된 것 (pi가 실증)

| mu 원칙 | pi에서의 근거 |
|---|---|
| messages = 유일한 상태 | 루프 컨텍스트는 `{systemPrompt, messages, tools}`가 전부 |
| 코어 루프 ~150줄 | pi 핵심 루프도 부가 기능 빼면 ~30줄 |
| 프롬프트 외부 파일 (MU.md) | pi의 SYSTEM.md 오버라이드와 동일 개념 |
| 툴 실패 = 정보 | 모델이 받는 최종 형태 동일 (에러 텍스트 + isError) |
| 4개 코어 툴 | pi coding tools = 정확히 read/bash/edit/write |
| 권한 게이트는 mu 고유 가치 | pi는 권한 시스템 없음 (컨테이너 위임) |

### 조정/추가 결정

1. **루프 레벨 방어 try/catch 추가** — 툴 "throw 금지" 규약은 유지하되 안전망
2. **truncation 방어 채택** — `stopReason: "length"`면 tool call 실행 안 함
3. **`load_skill`은 명시적 툴로 확정** — pi의 "read로 읽어라" 방식의 신뢰성 문제 회피
4. **세션 저장 = 선형 JSONL append** — JSON dump 원칙의 구현 방식만 변경
5. **compaction을 P1 백로그에 등재** — 최소 버전으로
6. **`EventStream`(89줄) 이식** — 스트리밍 이벤트 프리미티브
7. **툴 description/에러 문구는 pi 것을 차용** — 프롬프트 엔지니어링 자산
8. **LLM 레이어는 pi와 동일하게 자체 SSE 파싱 + abortable 재시도** — SDK 내장
   재시도가 AbortSignal을 무시하는 문제는 mu에도 해당 (`maxRetries: 0` + raw Response)
9. **권한 게이트를 3레벨(allow/ask/deny)로 정식 설계** — bash·remote_exec 공통,
   `beforeToolCall` 단일 지점 (설계: docs/05)
