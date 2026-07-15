# Portable Agent Protocols — 천공카드 / 헬어딧 / 헬게이트

> semantica-codegraph-v2에서 확립된 세 프로토콜의 자립형 정의 + **이 레포(p0-platform) 치환표**.
> 에이전트는 CLAUDE.md의 요약 바인딩을 따르고, 상세 판단이 필요하면 이 문서가 SSOT다.

## p0-platform 치환표 (다른 레포 적용 시 치환 체크리스트 이행분)

| 원문 표기 | 이 레포에서 |
|---|---|
| `<repo-check-cmd>` (컴파일 증명) | `bun run typecheck` (turbo 캐시) / 단일 패키지는 `cd apps/accounts && bunx tsc --noEmit` |
| owner-local 유닛테스트 최소 단위 | `bun test src/features/<f>/__tests__/<file>.test.ts` — domain 테스트는 DB 불필요 |
| heavy rail (최후의 검증기) | RBAC 통합테스트(postgres 필요, DB 없으면 **자동 skip이라 공허 green 주의**) + 부팅 스모크(`/health`·`/api/auth/jwks`) + CI 전체(ratchet 포함) |
| 어딧 에이전트 스폰 방식 | Claude Code Agent tool — 적대/객관을 **별도 서브에이전트**로 스폰 (같은 컨텍스트에서 self-grep으로 대체 금지) |
| 회귀 매트릭스 | original trigger + edge + corner/negative 3종 — `__tests__/`에 owner-local로 |
| typed fail-closed 에러 매칭 | `@p0/contracts`의 `apiError.kind` enum으로 매칭 (`unauthorized`/`forbidden`/`validation`…). 문자열 substring 매칭 금지 |

---

## 1. 천공카드 모드 (Punch-Card Mode) — 검증 에스컬레이션 사다리

**한 줄 정의**: 천공카드 시절처럼 "빌드를 돌리기 전에 코드를 손으로 완전히 검증"한다.
빌드/테스트가 비싼 레포에서 검증 수단을 싼 것부터 비싼 것 순으로만 오른다.
조건부 모드가 아니라 **상시 default 검증 순서**다.

**사다리 (항상 이 순서, 건너뛰기 금지)**:

1. **정적 검증 우선** — 빌드 없이 닫을 수 있으면 빌드하지 않는다.
   - Read/grep으로 타입·시그니처 대조
   - 호출부(call site) 전수 확인
   - assertion 비공허성 검토 (tautology/`assert!(true)` 류 아닌지)
   - git history로 regression 타임라인 재검증
   - 진단 메시지·reason code는 한 레이어 위(config/registry/feature gate)부터 의심
2. **컴파일 증명** — `bun run typecheck`. compile-only 확인에 무거운 `test`를 쓰지 않는다.
3. **owner-local 유닛테스트** — compile clean 이후에만, **가장 작은 단위**로.
4. **e2e / 통합 / 시나리오 테스트는 최후** — 원인 축이 1~3으로 하나로 좁혀진 뒤
   **최종 확인용으로만**. heavy rail은 탐색기가 아니라 최종 검증기다.

**MUST NOT**:
- compile 미확인 상태에서 무거운 test/e2e 직행
- 원인 축이 좁혀지기 전 broad gate / e2e 재실행
- 정적으로 잡히는 실패(import/export/모듈 경로 drift 등)를 heavy compile/test로 발견하려는 행동
- 사다리를 근거로 closeout 필수 gate 생략 — 사다리는 **반복(iteration) 비용**의 순서일 뿐,
  완료 주장에 필요한 최종 gate/e2e를 면제하지 않는다
- "빌드 불가라 blocked" 핑계 — 빌드 없이 검증할 방법을 먼저 찾는다

**Why**: 무거운 레포에서는 한 번의 e2e가 수십 분~수 시간이고, 동시 세션 churn이
incremental 캐시를 무효화하며, 디스크/메모리 경합으로 false-RED가 난다.
실전에서 진짜 성과(RCA, fix, validator)의 대부분은 빌드 없이 정적으로 잡혔다.
빌드 비용 신호(경합 프로세스 다수, 디스크 floor 근접, broken 공유 트리)가 보이면
사다리를 더 보수적으로(정적 비중↑) 적용한다.

**산출물도 정적 친화**: 빌드가 막혔을 때의 deliverable은
정밀 RCA 핸드오프 문서 + fail-closed lint/validator(self-test 포함) + 티켓 —
즉 다음 작업자가 빌드 없이 닫을 수 있게 깔아두는 것.

---

## 2. 헬어딧 프로토콜 (Hell-Audit Protocol) — 적대+객관 이중 어딧을 clean까지 반복

**한 줄 정의**: 적대적 어딧과 객관적 어딧을 **분리된 시선(별도 에이전트)**으로 돌리고,
발견된 진짜 결함을 TDD로 막은 뒤, **같은 방식의 재어딧이 새 결함 0을 낼 때까지** 반복한다.
한 바퀴로 절대 끝내지 않는다.

**루프 (clean까지 반복)**:

1. **적대적 어딧 (adversarial)** — "가차없이 까라" 톤.
   결함/거짓-green/공허 assertion/우회/엔진 갭을 적극 찾는다. 의심을 default로 두고 반례를 만든다.
2. **객관적 어딧 (objective)** — 적대 어딧과 **분리된 별도 시선/에이전트**.
   실제 근거(소스 file:line, SUT 출력, 실측)로 결함이 진짜인지 검증·교정.
   적대 어딧의 false-positive를 여기서 거른다.
3. **TDD 보완** — 진짜 결함을 owner-local 회귀 테스트로 막고 fix.
   회귀 매트릭스 최소 3종: **original trigger + edge + corner/negative**.
   테스트가 결함을 실제로 재현하는 것을 먼저 확인 → fix → green 확인.
4. **동일 방식 재어딧** — 1~2를 *똑같은 방식으로* 다시. 새 결함이 나오면 3으로.
5. **종료 조건**: 적대+객관 양쪽에서 **새 진짜 결함 0** (= clean).
   그 전에 "done" 주장 금지.

**하드 룰**:
- **self-grep은 닫는 재어딧이 아니다.** 마지막 수정 후 반드시 독립 에이전트 재어딧을
  한 번 더 돈다. self-grep은 문법상 멀쩡하지만 사실관계가 stale한 결함
  (예: 머지 후 거짓이 된 상태 표기)을 절대 못 잡는다.
- 결함 판정은 추측 금지 — 반드시 근거 기반. "엔진 갭" 결론 전에 결정적 A/B 실험 선행.
- 빌드가 비싸면 어딧 자체도 천공카드 모드로 (정적 우선 + owner-local 유닛 검증).
- 재어딧이 매번 새 결함을 뱉으면 아직 clean 아님. 같은 입력에 새 결함 0이 나올 때까지.
- 어딧이 만든 recurrence-guard(lint 등)는 그 의미를 소유한 스코프로 좁혀서
  false-positive 0을 맞춘다. guard를 설명하는 prose가 guard 자신을 트립하지 않게
  실제 대상 site로만 스코프 + negative-control self-test를 붙인다.

**Why**: 한 바퀴 어딧은 항상 빵꾸를 남긴다. 적대만 하면 false-positive로 헛수고,
객관만 하면 confirmation bias. 둘을 분리하고 clean까지 반복해야 수렴한다.

**트리거**: 사용자가 "헬어딧" 톤을 쓸 때. 또한 큰 변경(다수 파일, cascading crate,
공개 API/wire-format 변경, RCA deliverable)은 사용자가 명시하지 않아도
commit 전 최소 1바퀴를 default로 돈다.

---

## 3. 헬게이트 (Hellgate) — 최대 강도 게이트 캠페인 / 테스트 등급

**한 줄 정의**: 작업물이 "지옥문"을 통과해야 한다는 강도 선언.
(a) 구현 전후의 **전수 적대 어딧 캠페인**과 (b) **헬게이트급 테스트 매트릭스**를 합친
캠페인 단위 개념이다. 헬어딧이 *루프 프로토콜*이라면, 헬게이트는 그 루프를 포함한
*캠페인의 강도와 범위* 지정이다.

**구성 요소**:

1. **Pre-implement 헬게이트 어딧** — 구현 착수 *전에* 계획/티켓 자체를 적대 어딧.
   - 계획의 전제가 stale인지 (이미 landed된 fix를 다시 하려는 건 아닌지 grep으로 확인)
   - 제안된 fix가 inert한 건 아닌지 (기존 메커니즘이 이미 보장하는지)
   - 자기모순/의존 누락이 없는지
   - 실전에서 pre-implement 어딧이 티켓 절반을 "이미 landed / inert / 잘못된 seam"으로 교정한 사례 다수.
2. **헬게이트급 테스트 매트릭스** — 신규/보강 테스트가 갖춰야 할 등급:
   - **SUT 출력에서 증거 추출** (테스트 내부에서 증거 조립 금지 — oracle과 evidence 분리)
   - **positive/negative 쌍** (성공 케이스마다 핵심 조건 하나를 제거하면 실패해야 하는 mutation 쌍)
   - **typed fail-closed 검증** (에러를 문자열 substring이 아니라 typed error variant로 매칭)
   - edge/corner/boundary/metamorphic/증분(before/after/fresh 등가) 축 포함
   - "구현에 의도적 버그를 심으면 이 테스트가 잡는가?" 시뮬레이션 통과
3. **N겹 레이어 인식** — 헬게이트 RCA에서는 **각 fix가 다음 레이어를 노출**하는 것이
   정상이다. 한 겹 고치고 "done"이 아니라, 레이어가 더 이상 나오지 않을 때까지
   같은 게이트를 재통과시킨다.
4. **Post-implement 헬게이트 어딧** — 착지 후 헬어딧 루프(§2)를 clean까지.
   family/wave 단위 작업이면 **각 family 완결마다** 어딧 1바퀴가 default.

**false-RED 주의**: 헬게이트 캠페인 중 RED가 나오면 먼저 **내 결함인지 환경 결함인지**
귀속한다 (공유 워킹트리의 동시 세션 미커밋 파손, stale baseline, feature-gate로 인한
0-match 공허 green 등). clean worktree/committed HEAD 기준으로 재현해서
pre-existing 여부를 정직하게 귀속한 뒤에만 판정한다.

**트리거**: 사용자가 "헬게이트" 톤을 쓸 때 — 해당 작업을 캠페인급 강도로 취급하고
위 1~4를 전부 적용한다.

---

## 세 프로토콜의 관계

```
천공카드  = 검증 "수단"의 비용 사다리 (항상 켜져 있는 default)
헬어딧    = 검증 "루프" — 적대+객관 이중 어딧 → TDD → clean까지 재어딧
헬게이트  = 검증 "캠페인" — pre/post 어딧 + 헬게이트급 테스트 + N겹 레이어 재통과
```

- 헬게이트 캠페인 안에서 헬어딧 루프를 돌리고, 그 모든 검증 스텝은 천공카드 사다리를 따른다.
- 셋 다 공통 기반: **주장에는 근거 2~3개 이상**(grep/read/실측), 추측 프레이밍 금지,
  proxy 신호 몇 개로 낙관 단정 금지 ("owner-local green ≠ production works"),
  "done" 주장은 실제 gate 통과 증거와 함께만.
