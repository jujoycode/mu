# 03. 아키텍처

## 레포 구조

```
mu/
├─ package.json    # bin: { "mu": "src/cli.ts" }
├─ CLAUDE.md       # mu를 "개발할 때" Claude Code가 읽는 파일
├─ MU.md           # mu "런타임이" 소비하는 시스템 프롬프트 (코드 밖!)
└─ src/
   ├─ cli.ts       # 진입점, REPL
   ├─ agent.ts     # 코어 루프 — 심장, ~150줄 유지 목표
   ├─ llm.ts       # Anthropic 스트리밍 래퍼
   ├─ types.ts     # Message, Tool 인터페이스
   └─ tools/
      ├─ index.ts  # 툴 레지스트리
      └─ read.ts / write.ts / edit.ts / bash.ts
```

> ⚠️ **MU.md ≠ CLAUDE.md.** MU.md는 mu가 실행될 때 읽는 시스템 프롬프트,
> CLAUDE.md는 mu를 개발하는 Claude Code 세션용. 혼동 금지.

## 코어 루프

```
messages = [system, task]
loop:
  res = llm.stream(messages, tools)
  if 툴콜 없음 → 최종 답변, 종료
  results = 각 툴콜 실행
  messages += [assistant 턴, results]
```

이게 전부다. `agent.ts`가 150줄을 넘어가면 설계가 잘못되고 있다는 신호.

## 핵심 설계 결정 4가지

### 1. 툴 인터페이스 고정
```ts
{ name, description, inputSchema, execute }
```
P1의 `remote_exec`, P2의 스킬 툴까지 전부 이 등뼈를 그대로 타고 올라간다.

### 2. `messages` 배열 = 유일한 상태
다른 곳에 상태를 만들지 않는다.
P1의 세션 저장/재개가 "이 배열을 JSON으로 덤프/복원"이 되도록.

### 3. 시스템 프롬프트는 코드 밖 (MU.md)
프롬프트는 코드보다 훨씬 자주 수정된다. 하드코딩 금지.

### 4. 툴 실패 = 크래시가 아니라 정보
예외를 던지지 말고 **에러 문자열을 모델에게 반환**한다.
모델이 실패를 보고 스스로 복구를 시도하는 것이 에이전트 루프의 본질.
초보 harness가 가장 많이 틀리는 지점.
