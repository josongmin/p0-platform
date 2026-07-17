# p0-platform — 에이전트 가이드

p0 백엔드 모노레포 (bun + turbo). 구조 규칙은 [ARCHITECTURE.md](./ARCHITECTURE.md)가 SSOT — 요약:

## 아키텍처 불변량 (어기면 lint/semgrep이 CI에서 죽인다)

1. **feature 슬라이스 × 헥사고날**: `features/<name>/{domain,ports.ts,adapters,service.ts,routes.ts,index.ts}`
2. **크로스 feature는 index.ts로만** — 딥 임포트 = eslint boundaries 에러
3. **domain/은 순수** — npm 패키지·벤더 SDK import 금지
4. **벤더 SDK는 adapters/ 밖 금지** — stripe는 billing/adapters, better-auth는 auth/adapters (semgrep 강제, `import type`만 예외)
5. **process.env는 lib/env.ts만** (semgrep 강제)
6. **feature 간 배선은 composition root(app.ts)** — 순환은 늦은 바인딩 (`setClaimsBuilder` 패턴)
7. 권한 매트릭스 SSOT = `auth/domain/roles.ts` — better-auth AC는 파생물

## 명령어

```bash
bun run typecheck / lint / test   # 검증 3종 (pre-push가 typecheck+unit 돌림)
bun run arch                      # 아키텍처 불변량 기계검사 (<1초) — 수정 루프마다 돌려라
bun run ratchet                   # 품질 라쳇 체크 (CI 게이트와 동일)
bun run ratchet:update            # 지표 개선 시 베이스라인 조이기 (커밋 필요)
bun run new:feature <app> <name>  # hex 골격 feature 스캐폴드 — 새 feature는 반드시 이걸로 시작
bun run db:push                   # drizzle 스키마 → DB
bun run auth:generate             # better-auth 플러그인 변경 시 스키마 재생성
```

## 함정 (이미 밟은 것들)

- **better-auth 1.6**: apiKey/passkey/sso는 `@better-auth/*` 별도 패키지 (`better-auth/plugins`에 없음)
- **auth 스키마는 생성물**: `packages/db/src/schema/auth.ts` 손대지 마라 — `bun run auth:generate`로만
- **eslint boundaries는 resolver 없으면 조용히 무력화** — `import/resolver` 설정 지우지 마라
- **통합테스트는 DB 필요**: `docker compose up -d postgres` — DB 없으면 자동 skip이라 "전부 통과"처럼 보일 수 있음, CI가 진짜 게이트
- **BETTER_AUTH_SECRET 바꾸면 jwks 테이블 클린업 필수** — 옛 시크릿으로 암호화된 키가 남아 "Failed to decrypt private key"로 전 테스트가 500 난다: `docker compose exec postgres psql -U p0 -d p0 -c 'DELETE FROM jwks;'`
- 라쳇 후퇴(coverage↓, any↑, knip↑, 억제주석/`.only`/`.skip`↑)는 CI fail — 우회하지 말고 원인 고쳐라. **baseline.json 직접 완화도 CI `guard-baseline`이 차단** (정당한 완화 = PR 제목 `[ratchet-loosen]` + 사유). 상세: ops-tools/ratchet/README.md

## 작업 방식

- TDD: 인터페이스 → 테스트(RED) → 구현(GREEN). domain 로직은 목 없이 단위테스트
- 새 prod 의존성 추가는 라쳇이 경고 — PR 설명에 사유 한 줄
- 커밋 전 훅 = staged eslint + **arch-check + ratchet quick** + gitleaks (<5초) — 아키텍처 위반·any/억제 증가는 커밋 순간 즉사한다. 느려졌으면 뭔가 잘못 만진 거다
- 새 feature는 `bun run new:feature`로 시작 (hex 골격 보장) — 기존 feature 복붙 금지

## 검증 프로토콜 — 천공카드 / 헬어딧 / 헬게이트

전문·근거·치환표는 [PROTOCOLS.md](./PROTOCOLS.md)가 SSOT. 바인딩 요약:

**천공카드 (상시 default)** — 검증은 반드시 이 사다리 순서, 건너뛰기 금지:
정적(Read/grep·호출부 전수·assertion 비공허성) → `bun run typecheck` →
owner-local `bun test src/features/<f>/__tests__/<file>.test.ts` →
heavy rail(RBAC 통합테스트·부팅 스모크·CI)은 원인이 좁혀진 뒤 **최종 확인용**.
compile 미확인 상태로 test/e2e 직행 금지. 단 사다리는 반복 비용의 순서일 뿐 —
완료 주장에 필요한 최종 gate는 면제되지 않는다.

**헬어딧 (트리거: "헬어딧" / 큰 변경은 commit 전 1바퀴 default)** —
① 적대 어딧(별도 에이전트, 가차없이) → ② 객관 어딧(또 다른 별도 에이전트,
file:line 근거로 false-positive 거름) → ③ 진짜 결함은 TDD로
(original trigger + edge + corner/negative 3종) → ④ 같은 방식 재어딧 →
**새 결함 0(clean)까지 반복.** self-grep은 닫는 재어딧이 아니다.

**헬게이트 (트리거: "헬게이트")** — 캠페인급: 구현 **전** 계획 자체를 적대 어딧
(전제 stale/이미 landed/inert 체크) + 테스트는 헬게이트급 매트릭스
(positive/negative mutation 쌍, `apiError.kind` typed 매칭 — substring 금지,
"버그 심으면 잡히나" 시뮬레이션) + fix가 다음 레이어를 노출하면 정상,
레이어가 안 나올 때까지 재통과 + 착지 후 헬어딧 clean까지.

공통: 주장에는 근거 2~3개(grep/read/실측), "done"은 gate 통과 증거와 함께만.
이 레포의 공허-green 함정: **DB 없으면 통합테스트가 자동 skip** — "전부 통과"를
proxy로 낙관 단정하지 마라.
