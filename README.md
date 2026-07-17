# p0-platform

p0 백엔드 모노레포 — 운영(accounts: 인증·조직·구독·미터링)부터 시작해
제품 백엔드(intel, llm-gateway, runner)까지 담는다.
구조 원칙은 [ARCHITECTURE.md](./ARCHITECTURE.md).

## Quickstart

```bash
docker compose up -d          # postgres(5432) + redis(6379)
cp .env.example .env          # BETTER_AUTH_SECRET 등 채우기
bun install
bun run db:push               # drizzle 스키마 → DB
bun run dev                   # accounts: http://localhost:4000
```

확인:

```bash
curl localhost:4000/health                 # {"ok":true,"service":"accounts"}
open http://localhost:4000/api/auth/reference   # better-auth 엔드포인트들
curl localhost:4000/api/auth/jwks          # 제품 API가 쓰는 JWKS
```

## Scripts

| 명령 | 설명 |
|---|---|
| `bun run dev` | 전체 dev (turbo) |
| `bun run typecheck` / `lint` / `test` | 검증 3종 |
| `bun run db:push` | drizzle 스키마 push (개발용) |
| `bun run auth:generate` | better-auth 플러그인 변경 시 auth 스키마 재생성 |

## apps/accounts — 현재 상태 (전 슬라이스 헥사고날)

| feature | 상태 |
|---|---|
| auth | better-auth 1.6 — org·teams·2FA·multi-session·apiKey·admin·JWT/JWKS. 권한 매트릭스 SSOT = `domain/roles.ts`, 가드 4종(`lib/guard.ts`) |
| billing | Stripe checkout·**customer portal**·webhook. Price는 env 주입 (`STRIPE_PRICE_*`) |
| entitlements | plan×role → JWT 클레임 (`definePayload` 주입) |
| usage | 미터링 적재 (멱등·입력경계) + `x-api-key` 가드 — Stripe meter 릴레이 TODO |
| email | Resend(fetch, SDK 없음) + **콘솔 폴백** — 인증·리셋·초대·삭제·이메일변경 배선 |
| audit | append-only 감사 로그 — 버스 이벤트 구독 + `GET /v1/audit/:orgId` (owner·admin) |

**계정/조직 라이프사이클** (4회 헬어딧에서 추가):
- **시트 한도 강제**: `membershipLimit`이 org plan 기준으로 초대·멤버추가를 차단 (free=3석). 늦은바인딩 resolver(`auth/hooks.ts`)로 순환 없이 배선.
- **계정 관리**: `deleteUser`(확인메일)·`changeEmail`(신주소 확인). 이메일 선점/미인증 우회 불가(better-auth 검증).
- **org 삭제 훅**: `beforeDeleteOrganization` → Stripe 구독 취소(FK cascade 전).
- **사용자 삭제 훅**: `beforeDelete` → 단독소유 org의 구독취소+삭제 (고아 org·유령구독 방지).
- **리텐션 프루닝**: `runRetentionPrune`(allSettled) — audit 365d/usage 180d/stripe_events 90d. cron: `bun run src/scripts/prune.ts`.

OpenAPI: `GET /openapi.json` → FE codegen:
`bunx openapi-typescript http://localhost:4000/openapi.json -o api.d.ts`

## 핵심 미완 3종 (5회차에서 구현)

- **usage → Stripe Billing Meter 릴레이**: `relayUsage`(cron) — 미릴레이 이벤트를 Stripe 미터로 전송, **행 단위 즉시 마킹**(배치 중단이 이미 전송분 재전송 안 하게), `timestamp` 전달(청구기간 정확), **35일 초과분 드롭**(Stripe 거부 무한재시도·이중청구 방지). free org(고객없음)는 non-billable 마킹→프루닝. `src/scripts/relay-usage.ts`.
- **JWT entitlement epoch(revocation)**: org별 `org_epoch` — plan/멤버십/역할/구독취소/사용자삭제 시 bump → 기존 JWT를 stale화. **제품 API용 서비스키 엔드포인트** `GET /v1/service/entitlements/:org/epoch`(x-api-key, org 스코프) + 순수 헬퍼 `isEntitlementStale`. cascade 멤버제거도 사용자삭제 훅이 명시 무효화.
- **Stripe e2e ✅ 실검증 완료**: 실제 test-mode Stripe로 구독→webhook→미터릴레이(집계값 8484 확인)→취소→dunning 전 흐름 통과. 상세: [apps/accounts/E2E-VERIFIED.md](apps/accounts/E2E-VERIFIED.md).

## 보안 하드닝 (5회 헬어딧 완료 — 142 tests, coverage 91.6%)

- **서비스 키 org-스코핑**: `metadata.orgId`로 org에 묶고 `keyAllowsOrg`는 null=deny(fail-closed). metadata는 object/JSON-string 양쪽 방어 + 비문자열/빈문자열 거부. 크로스-테넌트 위조 차단(통합테스트 실증).
- **webhook 멱등+원자성**: `applyWebhook`가 event.id 기록+upsert를 한 트랜잭션으로 → 중복 무시, 실패 시 롤백→재시도(롤백 회귀테스트). customer→org 역조회, 순서 워터마크, 미지 price 강등 방지.
- **입력 경계**: usage `quantity` finite+상한, `at` 청구윈도우(+5m/−90d) 강제. plan/status free-text는 zod 폴백, entitlements 오염값 free 폴백. body-size 256KB 제한(무인증 webhook DoS 방어).
- **멀티테넌시**: 모든 read 멤버십 가드(IDOR·미지역할 락아웃 테스트). `org_billing`·`usage_events`가 organization FK(cascade) → 고아row/죽은customer 부활 방지. `member (org,user)` 유니크 → 중복멤버십 레이스 차단.
- **세션/전송**: CORS+`trustedOrigins`(CSRF), prod Secure 쿠키, env가 prod https/시크릿/이메일인증 강제.
- **JWT staleness 완화**: 엔타이틀먼트 토큰 만료 15m→**5m** 단축(아래 한계 참조).
- **테스트 무결성**: `test-preload.ts`가 (1) app.ts를 import해 늦은바인딩 훅을 모든 테스트에 결정적 배선(fail-closed 안전) (2) CI에서 DB 미기동 시 run 전체 하드페일(보안 통합테스트 skip 증발 차단).
- **훅 fail-closed**: 시트/org삭제/유저삭제 resolver 미배선 시 조용히 통과(무제한 시트·취소 스킵) 대신 **throw** — 배선 버그가 과금 사고로 안 이어지게.

## ⚠️ 알려진 한계 (설계결정 — 착수 전 확인)

- **JWT staleness → epoch로 해소(소비자 있음)**: `apps/gateway`가 epoch를 실제 소비해 권한변경 후 토큰을 거부(revocation 실작동, e2e G3 증명). staleness 창 = gateway epoch 캐시 TTL(기본 10s). 남은 것은 accounts측 bump 내구성(아래 epoch best-effort)뿐.
- **gateway 쿼터가 in-memory (C1, 미해결)**: `apps/gateway`의 서버측 쿼터 카운터가 프로세스 메모리라 **재시작/멀티인스턴스 시 리셋 → 초과과금 가능**. 서버측 강제의 핵심인데 durable(Redis 원자적 INCR/DB)이 아님. gateway의 #1 미해결. (데모 범위)
- **시트 레이스 (±1~2석)**: `membershipLimit`은 count-then-insert라 경계 좌석에 동시 accept-invitation이 몰리면 한도를 1~2 초과 가능. `(org,user)` 유니크는 중복멤버십만 막음. 엄밀 강제는 org advisory-lock 필요 (better-auth 패치 없이는 불가). v1 허용.
- **usage 프루닝은 릴레이 워커 전까지 무효**: `pruneRelayedUsage`는 `relayedAt IS NOT NULL`만 삭제하는데 릴레이 워커 미구현이라 항상 0건 → `usage_events`는 무한증가(미청구 유실 방지 위해 의도적). 릴레이 워커가 실제 리텐션의 전제. prune 출력의 `usage.deleted=0`은 정상이지만 안전하진 않음.
- **org삭제 시 Stripe 취소 실패는 삼켜짐**: `cancelOrgSubscription`이 Stripe 오류를 catch(삭제 차단 안 함) → 일시적 Stripe 장애 시 유령구독 가능. reconciliation 잡 필요.
- **member 유니크는 수기 추가**: `auth:generate`가 `schema/auth.ts`를 덮어쓰면 `member_org_user_uidx` **재적용 필수**.
- **릴레이는 best-effort(아직 outbox 아님)**: Stripe 전송 성공 후 마킹 실패로 프로세스가 죽으면 그 1행이 재전송될 수 있음(Stripe identifier 멱등은 ~24h만 보장). 미설정 meter는 큐 앞을 막을 수 있음(head-of-line). 다중 워커 동시실행 시 `FOR UPDATE SKIP LOCKED` 필요. → 트래픽 생기면 outbox+advisory-lock+dead-letter.
- **epoch는 best-effort 방어층(하드 backstop은 5분 만료)**: bump가 fire-and-forget 버스라 DB 실패 시 유실 가능하고, 훅이 mutation 이후 비동기라 bump 착지 전 짧은 창 존재. 완전 무결성은 mutation 트랜잭션 내 동기 bump + 리컨실 스윕 필요. 지금은 5분 만료가 하드 상한.
- **usage 다운그레이드 창 유실**: 유료→무료 전환 사이 미릴레이분은 non-billable로 마킹돼 유실 가능(record 시점 billable 스냅샷 필요).

## TODO (다음 순서)

- [ ] Stripe Price/Meter 생성 → `STRIPE_PRICE_*`·`STRIPE_METER_*` + 서비스키 발급 시 `metadata.orgId`
- [ ] Stripe 테스트키로 e2e 실검증 (`src/scripts/stripe-e2e.ts` + `stripe listen`)
- [ ] 릴레이 outbox+advisory-lock+dead-letter (best-effort → 정확) / 다운그레이드 billable 스냅샷
- [ ] **gateway 쿼터 durable화(Redis 원자적 카운터)** — 서버측 쿼터의 재시작/멀티인스턴스 초과과금 해소 (C1)
- [ ] epoch 동기 bump(mutation 트랜잭션 내) + 리컨실 스윕 (best-effort → 하드 revocation)
- [ ] gateway 멀티org(글로벌 read 키 or 배치 epoch 엔드포인트) + usage 발행 durable outbox
- [ ] 시트 레이스 엄격화(advisory-lock) + org삭제 Stripe취소 reconciliation
- [ ] 멀티인스턴스 rate limit + 이메일 rate limit: `secondaryStorage`에 redis
- [ ] passkey 재배선 / dunning(`invoice.payment_failed`) / 데이터 export / audit 확대
- [ ] FE(se-dot-field) auth-stage를 better-auth client SDK로 배선
