import { z } from 'zod';

// FE billing-stage/parts/data.ts 의 플랜 4종과 정렬.
export const planId = z.enum(['free', 'team', 'business', 'enterprise']);
export type PlanId = z.infer<typeof planId>;

export const billingCycle = z.enum(['monthly', 'annual']);
export type BillingCycle = z.infer<typeof billingCycle>;

// orgId는 경로(/v1/billing/:orgId/checkout)에서 — body에 중복으로 안 받는다.
// enterprise는 sales-led(가격 없음) → self-serve checkout에서 제외 (미제외 시 500 유발).
export const checkoutPlan = planId.exclude(['free', 'enterprise']);
export type CheckoutPlan = z.infer<typeof checkoutPlan>;

export const checkoutRequest = z.object({
  plan: checkoutPlan,
  cycle: billingCycle,
});
export type CheckoutRequest = z.infer<typeof checkoutRequest>;

export const subscriptionStatus = z.enum([
  'none',
  'trialing',
  'active',
  'past_due',
  'canceled',
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatus>;

export const orgBillingStatus = z.object({
  orgId: z.string(),
  plan: planId,
  status: subscriptionStatus,
  currentPeriodEnd: z.string().datetime().nullable(),
});
export type OrgBillingStatus = z.infer<typeof orgBillingStatus>;
