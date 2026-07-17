# ops-tools/ratchet

품질 라쳇 — 지표는 **좋아지는 방향으로만** 움직인다. CI가 매 PR 판정.

## 지표

| 지표 | 방향 | 잡는 것 |
|---|---|---|
| `coveragePct` | ⬆만 | 라인 커버리지 (apps/* 합산, **테스트 파일·생성물 제외**) |
| `anyCount` | ⬇만 | `: any` / `as any` / `<any>` / `any[]` |
| `knipIssues` | ⬇만 | 미사용 파일·export·의존성 |
| `suppressionCount` | ⬇만 | `@ts-ignore` `@ts-expect-error` `eslint-disable` `.only(` `.skip(` — 검사를 끄는 모든 탈출구 (`.skipIf(` 조건부는 허용) |
| `prodDeps` | 경고만 | prod 의존성 증가 시 PR에 사유 요구 |

## 명령

```bash
bun run ratchet          # check — CI 게이트와 동일
bun run ratchet:update   # 개선분을 베이스라인에 반영 (조이기, 커밋 필요)
```

## 개악 방지 (안티-탬퍼)

`baseline.json`을 직접 수정해 기준을 낮추는 우회는 CI의 `guard-baseline` 스텝이
base 브랜치의 baseline과 비교해서 차단한다. 측정방식 변경 등 정당한 완화는
**PR 제목에 `[ratchet-loosen]` + 본문에 사유** 필수.

## 주의

- 측정은 전체 테스트를 실행한다 — **DB(postgres)가 떠 있어야** 통합테스트 포함 정확한 수치가 나온다. DB 다운이면 경고가 뜨고, 그 상태로 `update` 하면 baseline이 낮아져 CI guard에 걸린다 (의도된 자기방어).
- CI는 `RATCHET_REUSE_LCOV=1`로 테스트 재실행 없이 기존 lcov를 재사용한다.
