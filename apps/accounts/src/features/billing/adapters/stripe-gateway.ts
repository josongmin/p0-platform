// driven adapter — Stripe SDK는 이 파일 밖으로 안 샌다 (service는 ports·domain만).
import Stripe from 'stripe';
import { env } from '../../../lib/env';
import { buildPriceTable } from '../domain/price-table';
import type { SubscriptionChange } from '../domain/webhook';
import type { CheckoutGateway, PortalGateway } from '../ports';

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
      success_url: `${env.BETTER_AUTH_URL}/billing/success`,
      cancel_url: `${env.BETTER_AUTH_URL}/billing/cancel`,
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
      return_url: `${env.BETTER_AUTH_URL}/billing`,
    });
    return { url: session.url };
  },
};

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
): Promise<SubscriptionChange | null> {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  const event = await stripe().webhooks.constructEventAsync(
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  );
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
