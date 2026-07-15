// domain — Stripe 이벤트 → 구독상태/플랜 매핑. 순수 TS (Stripe SDK 타입도 금지).
export type SubscriptionStatusValue =
  | 'none'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';

export type PlanValue = 'free' | 'team' | 'business' | 'enterprise';

export function mapStripeStatus(
  stripeStatus: string,
  eventType: string,
): SubscriptionStatusValue {
  if (eventType === 'customer.subscription.deleted') return 'canceled';
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    default:
      return 'none';
  }
}

/** priceId → plan. 모르는 price는 free로 fail-safe (과금 사고 방지 방향) */
export function resolvePlan(
  priceId: string | undefined,
  priceTable: Record<string, string>,
): PlanValue {
  if (!priceId) return 'free';
  for (const [key, id] of Object.entries(priceTable)) {
    if (id === priceId) return key.split(':')[0] as PlanValue;
  }
  return 'free';
}
