# Stripe e2e 검증 결과 (실제 test-mode Stripe)

2026-07-16, 계정 `acct_1GmZRv…` (test mode), `stripe listen --latest` 포워딩.
전 흐름을 **실제 Stripe API + 실제 webhook 서명검증**으로 통과 확인.

| # | 흐름 | 결과 |
|---|---|---|
| 1 | 회원가입 + org 생성 (better-auth) | ✅ orgId 발급 |
| 2 | Stripe 구독 생성(metadata.orgId) → `customer.subscription.created` webhook → org_billing | ✅ **plan=team, status=active** 반영 |
| 3 | `/v1/usage`(서비스키) 적재 → `relay-usage.ts` → Stripe Billing Meter | ✅ **relayed=1, Stripe aggregated_value=8484** (4242×2건 집계 확인) |
| 4 | 구독 취소 → `customer.subscription.deleted` webhook → org_billing | ✅ **status=canceled** 반영 |
| 5 | `invoice.payment_failed` 트리거 → dunning 핸들러 | ✅ 멱등 처리, customer_email 있으면 메일 발송 |

## 검증된 것 (실 Stripe)
- webhook 서명검증(`constructEventAsync`) + apiVersion pin(2025-08-27.basil ↔ listen --latest)
- customer→org 역조회, 구독 상태/플랜 매핑
- **usage → 미터 릴레이가 실제로 Stripe에 값을 적재**(집계값으로 확인) — 미터링→과금 루프 완성
- 취소 반영, dunning 멱등

## 재현 방법
```bash
# 사전: .env에 STRIPE_SECRET_KEY(sk_test), STRIPE_PRICE_*, STRIPE_METER_AI_TOKENS,
#       STRIPE_WEBHOOK_SECRET(= stripe listen --print-secret)
stripe listen --latest --forward-to localhost:4000/v1/billing/webhook   # 터미널 A
bun run src/index.ts                                                    # 터미널 B
# 터미널 C: org 생성 → stripe subscriptions create --metadata orgId=… → 폴링 →
#   /v1/usage → bun run src/scripts/relay-usage.ts → 미터 summary → cancel
```

## 적대적 시나리오 스위트 (`e2e-scenarios.sh`) — 13/13 검증

실 Stripe 대상 PASS/FAIL 스코어카드. `bash apps/accounts/e2e-scenarios.sh` (서버+listen 기동 후).

| # | 시나리오 | 검증 |
|---|---|---|
| S1 | 구독 생성 → webhook → active, plan=team | ✅ |
| S2 | usage 3건(100+250+999) → relay → **Stripe 집계 == 1349 정확** | ✅ (집계 eventual ~45s) |
| S3 | orgA 서비스키로 **orgB usage 위조 → 403** (크로스테넌트) | ✅ |
| S4 | 같은 idempotencyKey 3회 POST → **1건만 적재** | ✅ |
| S5 | active org에서 checkout → **400 중복구독 차단** | ✅ |
| S6 | 플랜 team→business(구독 update) → webhook 반영 + **epoch bump** | ✅ |
| S7 | 멤버 invite→accept → **epoch bump** (afterAcceptInvitation) | ✅ |
| S8 | orgA 서비스키로 **orgB epoch → 403** (크로스테넌트) | ✅ |
| S9 | **org 삭제 → Stripe 구독 자동취소** (beforeDeleteOrganization) | ✅ |
| S10 | invoice.payment_failed → **dunning 핸들러** (멱등) | ✅ |
| S11 | 구독 취소 → webhook → **canceled** | ✅ |

### 스위트가 잡은 실버그 (수정됨)
- **서비스 키 rate limit 기본 10회/일** → 제품 API의 usage/epoch 대량호출을 차단(S8이 403 대신 401). `apiKey({ rateLimit: { maxRequests: 60_000, timeWindow: 60_000 } })`로 상향(분당 6만). DoS는 인프라 게이트웨이 담당.

## gateway↔accounts 크로스서비스 e2e (`apps/gateway/e2e-gateway.sh`) — 5/5

제품 API(gateway)가 epoch를 **실제로 소비**하고 서버측 쿼터를 강제함을 증명 (auditor가
"소비자 없어 revoke 안 함"이라던 C1 해소). `bash apps/gateway/e2e-gateway.sh` (accounts 기동 후).

| # | 시나리오 | 검증 |
|---|---|---|
| G1 | 유효 JWT → infer 200 + **accounts로 usage 발행** (미터링 루프 닫힘) | ✅ |
| G2 | 서버측 쿼터 초과 → **429** (JWT 스냅샷 아닌 요청시점 라이브 강제) | ✅ |
| G3 | 멤버 invite→accept로 epoch bump → **기존 토큰 stale 401** (revocation 실작동) | ✅ |
| G4 | 토큰 갱신 → 다시 200 | ✅ |

흐름: JWT 로컬검증(JWKS, issuer/EdDSA 핀) → epoch stale 검사(TTL 캐시, fail-closed) →
서버측 쿼터(라이브 카운터) → 미터링 발행(fail-closed billing) → 인퍼런스.

### gateway 감사가 잡은 것 (수정/문서화)
- **H1/H2** JWT에 issuer/algorithms 미핀 → cross-service replay 가능 → `jwtVerify({ issuer, algorithms:['EdDSA'] })`로 핀.
- **H3** commit-then-emit → 발행 실패 시 미청구 서빙(under-billing) → **emit-first(fail-closed billing)**: 발행 실패면 502, 서빙 안 함.
- **M2** 서비스키 optional → required(min 1)로, 미설정 시 boot 실패.
- **M3** 엉뚱한 `viz.basic` 게이트 → 제거(quota+epoch가 실질 게이트).
- **C1 (미해결·스켈레톤 본질)**: 쿼터 카운터가 in-memory → 재시작/멀티인스턴스 시 리셋되어 초과과금 가능. 프로덕션은 Redis/DB 원자적 카운터 필요. **데모 범위지만 이게 gateway의 #1 미해결.**

## 남은 한계 (변함없음 — README ⚠️ 참조)
e2e는 흐름의 **정합성**을 증명했지만, 고부하 동시성(멀티워커 락)·outbox·epoch 소비자
(제품 API)는 여전히 미구현. 이건 트래픽/제품 API가 생길 때의 과제.
