// driven adapter — Stripe SDK는 이 파일 밖으로 안 샌다 (service는 ports·domain만).
import Stripe from 'stripe';
import { env, appBaseUrl } from '../../../lib/env';
import { buildPriceTable } from '../domain/price-table';
import type { InvoiceChange, SubscriptionChange } from '../domain/webhook';
import type { CheckoutGateway, PortalGateway, SubscriptionGateway } from '../ports';

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  // apiVersion 고정 — 계정 기본 버전과 SDK 타입이 어긋나 webhook 필드 위치가
  // 달라지는 사고(current_period_end 등)를 막는다.
  client ??= new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-08-27.basil' });
  return client;
}

// env로 주입 — 미설정 plan은 테이블에 없어서 checkout이 명시적으로 실패한다.
export const PRICE_IDS: Record<string, string> = buildPriceTable({
  teamMonthly: env.STRIPE_PRICE_TEAM_MONTHLY,
  teamAnnual: env.STRIPE_PRICE_TEAM_ANNUAL,
  businessMonthly: env.STRIPE_PRICE_BUSINESS_MONTHLY,
  businessAnnual: env.STRIPE_PRICE_BUSINESS_ANNUAL,
});

export const checkoutGateway: CheckoutGateway = {
  createSession: async ({ orgId, priceId, customerId }) => {
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customerId ?? undefined,
      client_reference_id: orgId,
      // 고객 대면 FE로 리다이렉트 (백엔드 origin이면 404).
      success_url: `${appBaseUrl()}/billing/success`,
      cancel_url: `${appBaseUrl()}/billing/cancel`,
      subscription_data: { metadata: { orgId } },
    });
    if (!session.url) throw new Error('stripe returned no checkout url');
    return { url: session.url };
  },
};

export const portalGateway: PortalGateway = {
  createSession: async ({ customerId }) => {
    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appBaseUrl()}/billing`,
    });
    return { url: session.url };
  },
};

export const subscriptionGateway: SubscriptionGateway = {
  cancel: async (subscriptionId) => {
    await stripe().subscriptions.cancel(subscriptionId);
  },
};

/** Stripe Billing Meter 이벤트 전송 (usage 릴레이가 billing 공개 API로 호출). */
export async function recordMeterEvent(input: {
  eventName: string;
  customerId: string;
  value: number;
  identifier: string;
  timestampSec: number; // 사용 시각(unix초) — 청구기간 정확 배정. 미지정 시 Stripe는 수신시각 사용
}): Promise<void> {
  await stripe().billing.meterEvents.create({
    event_name: input.eventName,
    // ⚠️ identifier 멱등은 Stripe에서 "최소 24시간 롤링 윈도우"만 보장 — 영구 아님.
    // 그래서 릴레이는 전송 즉시 relayedAt 마킹(호출측 F3)하고, 35일 초과분은 아예 안 보낸다.
    identifier: input.identifier,
    timestamp: input.timestampSec,
    payload: { stripe_customer_id: input.customerId, value: String(input.value) },
  });
}

// 구독 이벤트 3종만 관심 — 타입 좁히기용 상수
const SUBSCRIPTION_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

/**
 * webhook 서명 검증 + Stripe.Event → 도메인 SubscriptionChange 파싱.
 * Stripe 타입은 이 함수 밖으로 새지 않는다 (service는 SubscriptionChange만 본다).
 * 구독 외 이벤트/서명 실패는 null.
 */
export async function parseWebhookEvent(
  rawBody: string,
  signature: string,
): Promise<SubscriptionChange | InvoiceChange | null> {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  const event = await stripe().webhooks.constructEventAsync(
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  );

  // dunning — 결제 실패
  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object as Stripe.Invoice;
    if (!inv.customer) return null;
    return {
      invoiceKind: 'payment_failed',
      eventId: event.id,
      stripeCustomerId: typeof inv.customer === 'string' ? inv.customer : inv.customer.id,
      customerEmail: inv.customer_email ?? null,
      amountDue: inv.amount_due,
      currency: inv.currency,
      attemptCount: inv.attempt_count ?? 1,
    };
  }

  const eventType = SUBSCRIPTION_EVENTS.find((t) => t === event.type);
  if (!eventType) return null;

  const sub = event.data.object as Stripe.Subscription;
  const item = sub.items.data[0];
  const periodEnd =
    item && Number.isFinite(item.current_period_end) ? item.current_period_end : null;

  return {
    eventId: event.id,
    eventCreated: event.created,
    eventType,
    stripeCustomerId:
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    metadataOrgId: sub.metadata?.orgId ?? null,
    priceId: item?.price.id,
    stripeStatus: sub.status,
    currentPeriodEnd: periodEnd,
  };
}
