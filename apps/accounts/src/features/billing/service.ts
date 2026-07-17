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
import { env } from '../../lib/env';
import { sendDunningEmail } from '../email'; // ✅ 크로스 feature — 공개 API
import { billingStore } from './adapters/store';
import {
  checkoutGateway,
  portalGateway,
  subscriptionGateway,
  PRICE_IDS,
} from './adapters/stripe-gateway';
import {
  decideBillingUpdate,
  type InvoiceChange,
  type SubscriptionChange,
} from './domain/webhook';

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

/** usage 릴레이가 쓰는 공개 읽기 API — org의 Stripe customer id (없으면 null). */
export async function getCustomerId(orgId: string): Promise<string | null> {
  return (await billingStore.get(orgId))?.stripeCustomerId ?? null;
}

// Stripe 미터 이벤트 전송 — usage 릴레이가 billing 공개 API로 호출 (Stripe는 billing 소관).
export { recordMeterEvent } from './adapters/stripe-gateway';

type CheckoutError = 'no-price' | 'already-subscribed';

// 이미 유효한 구독이 있는 상태 — 새 checkout 대신 portal로 유도 (P1: 중복구독/이중과금)
const ACTIVE_STATUSES = new Set<SubscriptionStatus>(['active', 'trialing', 'past_due']);

export async function createCheckout(
  orgId: string,
  req: { plan: CheckoutPlan; cycle: BillingCycle },
): Promise<{ ok: true; url: string } | { ok: false; error: CheckoutError }> {
  const existing = await billingStore.get(orgId);
  // 상태 먼저: 이미 구독 중이면 두 번째 Stripe 구독을 만들지 않는다 (이중과금 방지).
  if (existing && ACTIVE_STATUSES.has(existing.status as SubscriptionStatus)) {
    return { ok: false, error: 'already-subscribed' };
  }
  const priceId = PRICE_IDS[`${req.plan}:${req.cycle}`];
  // 미설정 plan은 500(→스택 노출)이 아니라 클라이언트가 다룰 수 있는 실패로 반환.
  if (!priceId) return { ok: false, error: 'no-price' };

  const { url } = await checkoutGateway.createSession({
    orgId,
    priceId,
    customerId: existing?.stripeCustomerId ?? null,
  });
  return { ok: true, url };
}

/**
 * org 삭제 직전 훅 — Stripe 구독을 취소해 삭제 후 청구/webhook을 막는다.
 * 구독 없으면 no-op. Stripe 실패는 삭제를 막지 않고 로깅(미취소 구독은 수동/재시도 정리).
 */
export async function cancelOrgSubscription(orgId: string): Promise<void> {
  // 취소는 엔타이틀먼트 변경 → 즉시 epoch 무효화(webhook 왕복 대기 안 함).
  bus.emit('entitlements.invalidate', { orgId });
  const row = await billingStore.get(orgId);
  if (!row?.stripeSubscriptionId) return;
  try {
    await subscriptionGateway.cancel(row.stripeSubscriptionId);
  } catch (e) {
    console.error(`[billing] failed to cancel Stripe sub for org ${orgId}:`, e);
  }
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
  change: SubscriptionChange | InvoiceChange | null,
): Promise<void> {
  if (!change) return;
  if ('invoiceKind' in change) {
    await handleInvoiceEvent(change);
    return;
  }

  const existing = await billingStore.getByCustomerId(change.stripeCustomerId);
  const decision = decideBillingUpdate(
    change,
    existing
      ? { orgId: existing.orgId, plan: existing.plan, watermark: existing.watermark }
      : null,
    PRICE_IDS,
  );

  // 반영하지 않는 이벤트(stale/no-org)는 처리기록도 남기지 않는다 — 재시도 시 재평가.
  if (!decision.apply) {
    console.warn(`[billing] webhook ${change.eventId} skipped: ${decision.reason}`);
    return;
  }

  // 멱등+원자성: event.id 기록과 upsert를 한 트랜잭션으로 (R3).
  // 중복이면 applied=false. upsert 실패 시 롤백 → Stripe 재시도가 다시 처리.
  const applied = await billingStore.applyWebhook(change.eventId, {
    orgId: decision.orgId,
    stripeCustomerId: change.stripeCustomerId,
    stripeSubscriptionId: change.stripeSubscriptionId,
    plan: decision.plan,
    status: decision.status,
    currentPeriodEnd: decision.currentPeriodEnd,
    watermark: decision.watermark,
  });

  if (applied) {
    bus.emit('billing.subscription.updated', {
      orgId: decision.orgId,
      plan: decision.plan as PlanId,
      status: decision.status as SubscriptionStatus,
    });
  }
}

/**
 * dunning — invoice.payment_failed 처리. event.id 멱등(재시도 중복발송 방지) →
 * 결제 실패 알림 메일(customer_email) → 감사/알림용 이벤트 발행.
 * org_billing 상태는 건드리지 않는다(구독 상태는 subscription.updated가 소유).
 */
async function handleInvoiceEvent(change: InvoiceChange): Promise<void> {
  const fresh = await billingStore.markEventProcessed(change.eventId);
  if (!fresh) return; // Stripe 재시도 중복

  const existing = await billingStore.getByCustomerId(change.stripeCustomerId);
  const amountLabel = `${(change.amountDue / 100).toFixed(2)} ${change.currency.toUpperCase()}`;

  if (change.customerEmail) {
    try {
      await sendDunningEmail({
        to: change.customerEmail,
        amountLabel,
        attemptCount: change.attemptCount,
        portalUrl: `${env.BETTER_AUTH_URL}/billing`,
      });
    } catch (e) {
      console.error('[billing] dunning email failed:', e);
    }
  } else {
    console.warn(`[billing] payment_failed ${change.eventId} — no customer_email, email skipped`);
  }

  if (existing) {
    bus.emit('billing.payment_failed', {
      orgId: existing.orgId,
      amountDue: change.amountDue,
      attemptCount: change.attemptCount,
    });
  }
}

/** 리텐션 프루닝 — cutoff 이전 stripe_events(멱등 원장) 삭제. */
export function pruneStripeEvents(cutoff: Date): Promise<number> {
  return billingStore.pruneEventsBefore(cutoff);
}
