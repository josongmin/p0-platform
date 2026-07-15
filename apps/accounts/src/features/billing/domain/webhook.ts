// domain — webhook 반영 결정 로직. Stripe 타입 없이 순수. 목 없이 단위테스트.
import {
  mapStripeStatus,
  resolvePlan,
  type PlanValue,
  type SubscriptionStatusValue,
} from './subscription';

// 어댑터가 Stripe.Event를 이 형태로 파싱해서 넘긴다 (벤더 타입은 adapters/에 격리).
export type SubscriptionChange = {
  eventId: string;
  eventCreated: number; // unix 초 — 순서 워터마크
  eventType:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted';
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  metadataOrgId: string | null;
  priceId: string | undefined;
  stripeStatus: string;
  currentPeriodEnd: number | null; // unix 초
};

export type ExistingBilling = {
  orgId: string;
  plan: string;
  watermark: number | null;
} | null;

export type BillingDecision =
  | { apply: false; reason: string }
  | {
      apply: true;
      orgId: string;
      plan: PlanValue;
      status: SubscriptionStatusValue;
      currentPeriodEnd: Date | null;
      watermark: number;
    };

export function decideBillingUpdate(
  change: SubscriptionChange,
  existingByCustomer: ExistingBilling,
  priceTable: Record<string, string>,
): BillingDecision {
  // org 확정: 저장된 customer→org 매핑이 진실. metadata.orgId는 최초 생성 시 폴백만
  // (metadata는 Stripe 대시보드에서 편집 가능 → 신뢰 경계 아님).
  const orgId = existingByCustomer?.orgId ?? change.metadataOrgId;
  if (!orgId) {
    return { apply: false, reason: 'no org (unknown customer + no metadata.orgId)' };
  }

  // 순서 보증: 이미 반영한 것보다 오래된 이벤트는 무시 (지연 재배송 방지)
  if (
    existingByCustomer?.watermark != null &&
    change.eventCreated < existingByCustomer.watermark
  ) {
    return { apply: false, reason: 'stale event (older than watermark)' };
  }

  const status = mapStripeStatus(change.stripeStatus, change.eventType);
  let plan = resolvePlan(change.priceId, priceTable);

  // 미지의 price(=env 테이블 드리프트)로 유료 구독을 free로 강등하지 않는다.
  // 삭제 이벤트가 아니고 priceId는 있는데 테이블에 없으면 기존 plan 보존.
  if (
    change.eventType !== 'customer.subscription.deleted' &&
    change.priceId &&
    plan === 'free' &&
    existingByCustomer?.plan &&
    existingByCustomer.plan !== 'free'
  ) {
    plan = existingByCustomer.plan as PlanValue;
  }

  return {
    apply: true,
    orgId,
    plan,
    status,
    currentPeriodEnd:
      change.currentPeriodEnd !== null
        ? new Date(change.currentPeriodEnd * 1000)
        : null,
    watermark: change.eventCreated,
  };
}
