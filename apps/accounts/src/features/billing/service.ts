// 유스케이스 — domain(매핑/결정) + ports(store/gateway) 조립. Stripe 타입 없음.
import {
  planId as planIdSchema,
  subscriptionStatus as statusSchema,
  type BillingCycle,
  type CheckoutPlan,
  type OrgBillingStatus,
  type PlanId,
  type SubscriptionStatus,
} from '@p0/contracts';
import { bus } from '../../lib/events';
import { billingStore } from './adapters/store';
import { checkoutGateway, portalGateway, PRICE_IDS } from './adapters/stripe-gateway';
import { decideBillingUpdate, type SubscriptionChange } from './domain/webhook';

export async function getStatus(orgId: string): Promise<OrgBillingStatus> {
  const row = await billingStore.get(orgId);
  // 경계 검증: plan/status는 free-text 컬럼 → zod로 파싱해 오염된 값이
  // 하위로 '거짓말 캐스트'되지 않게 한다 (실패 시 free/none 폴백).
  const plan = planIdSchema.safeParse(row?.plan);
  const status = statusSchema.safeParse(row?.status);
  return {
    orgId,
    plan: plan.success ? plan.data : 'free',
    status: status.success ? status.data : 'none',
    currentPeriodEnd: row?.currentPeriodEnd?.toISOString() ?? null,
  };
}

/** entitlements가 쓰는 공개 읽기 API (index.ts로 재수출) */
export async function getPlan(orgId: string): Promise<PlanId> {
  return (await getStatus(orgId)).plan;
}

export type CheckoutError = 'no-price';

export async function createCheckout(
  orgId: string,
  req: { plan: CheckoutPlan; cycle: BillingCycle },
): Promise<{ ok: true; url: string } | { ok: false; error: CheckoutError }> {
  const priceId = PRICE_IDS[`${req.plan}:${req.cycle}`];
  // 미설정 plan은 500(→스택 노출)이 아니라 클라이언트가 다룰 수 있는 실패로 반환.
  if (!priceId) return { ok: false, error: 'no-price' };

  const existing = await billingStore.get(orgId);
  const { url } = await checkoutGateway.createSession({
    orgId,
    priceId,
    customerId: existing?.stripeCustomerId ?? null,
  });
  return { ok: true, url };
}

/** Stripe customer portal — 결제수단/구독 관리 화면. 결제이력 없으면 null */
export async function createPortal(orgId: string): Promise<{ url: string } | null> {
  const row = await billingStore.get(orgId);
  if (!row?.stripeCustomerId) return null;
  return portalGateway.createSession({ customerId: row.stripeCustomerId });
}

/**
 * Stripe webhook 반영. 어댑터가 파싱한 SubscriptionChange를 받아:
 *  1) event.id 멱등 (Stripe 재시도/중복 차단)
 *  2) customer→org 역조회로 org 확정 (metadata 신뢰 안 함)
 *  3) 순서/미지-price 결정은 domain(decideBillingUpdate)
 * change=null(구독 외 이벤트/서명검증만)은 무시.
 */
export async function handleWebhookEvent(
  change: SubscriptionChange | null,
): Promise<void> {
  if (!change) return;

  // 멱등: 처음 보는 event.id만 처리 (원자적 insert)
  const fresh = await billingStore.markEventProcessed(change.eventId);
  if (!fresh) return;

  const existing = await billingStore.getByCustomerId(change.stripeCustomerId);
  const decision = decideBillingUpdate(
    change,
    existing
      ? { orgId: existing.orgId, plan: existing.plan, watermark: existing.watermark }
      : null,
    PRICE_IDS,
  );

  if (!decision.apply) {
    console.warn(`[billing] webhook ${change.eventId} skipped: ${decision.reason}`);
    return;
  }

  await billingStore.upsert({
    orgId: decision.orgId,
    stripeCustomerId: change.stripeCustomerId,
    stripeSubscriptionId: change.stripeSubscriptionId,
    plan: decision.plan,
    status: decision.status,
    currentPeriodEnd: decision.currentPeriodEnd,
    watermark: decision.watermark,
  });
  bus.emit('billing.subscription.updated', {
    orgId: decision.orgId,
    plan: decision.plan as PlanId,
    status: decision.status as SubscriptionStatus,
  });
}
