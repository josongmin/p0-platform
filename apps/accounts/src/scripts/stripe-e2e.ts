// Stripe e2e 검증 하네스 — 실제 Stripe TEST 키가 필요 (자동 테스트로는 불가).
// 실행:
//   STRIPE_SECRET_KEY=sk_test_... \
//   STRIPE_PRICE_TEAM_MONTHLY=price_... \
//   STRIPE_METER_AI_TOKENS=... \
//   bun run src/scripts/stripe-e2e.ts
//
// 검증 흐름 (수동 확인 항목):
//   1. checkout 세션 생성 → URL 반환되는가
//   2. (수동) 테스트 카드로 결제 → webhook customer.subscription.created 도착
//   3. org_billing.plan/status 반영 확인
//   4. usage 적재 → relayUsage → Stripe 미터에 값 도착 확인 (대시보드)
//   5. portal 세션 생성 확인
//   6. 구독 취소 → status canceled 반영 확인
import { env } from '../lib/env';

if (!env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY (test) 필요 — 이 하네스는 실제 Stripe와 통신한다.');
  process.exit(1);
}

console.log('[stripe-e2e] 준비됨. 아래를 순서대로 수동 확인:');
console.log(`
  ☐ 1. POST /v1/billing/:org/checkout → { url } (Stripe checkout)
  ☐ 2. 테스트카드(4242…) 결제 → /v1/billing/webhook 수신 (stripe listen 필요)
  ☐ 3. GET /v1/billing/:org → plan=team, status=active
  ☐ 4. POST /v1/usage (서비스키) → relay-usage 실행 → Stripe Meters 대시보드에 값
  ☐ 5. POST /v1/billing/:org/portal → { url }
  ☐ 6. 대시보드에서 구독취소 → webhook → status=canceled
  ☐ 7. org 삭제 → 구독 자동취소(beforeDeleteOrganization) 확인
`);
console.log('로컬 webhook 포워딩: stripe listen --forward-to localhost:4000/v1/billing/webhook');
process.exit(0);
