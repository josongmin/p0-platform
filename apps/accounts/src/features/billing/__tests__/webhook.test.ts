// decideBillingUpdate — webhook 반영 결정의 순수 코너케이스. DB/Stripe 없이 검증.
import { describe, expect, test } from 'bun:test';
import {
  decideBillingUpdate,
  type ExistingBilling,
  type SubscriptionChange,
} from '../domain/webhook';

const PRICES = { 'team:monthly': 'price_team', 'business:annual': 'price_biz' };

function change(over: Partial<SubscriptionChange> = {}): SubscriptionChange {
  return {
    eventId: 'evt_1',
    eventCreated: 1000,
    eventType: 'customer.subscription.updated',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    metadataOrgId: 'org_meta',
    priceId: 'price_team',
    stripeStatus: 'active',
    currentPeriodEnd: 2000,
    ...over,
  };
}

describe('decideBillingUpdate — org 확정', () => {
  test('저장된 customer→org 매핑이 metadata보다 우선 (metadata 위조 방어)', () => {
    const existing: ExistingBilling = { orgId: 'org_real', plan: 'team', watermark: null };
    const d = decideBillingUpdate(change({ metadataOrgId: 'org_attacker' }), existing, PRICES);
    expect(d.apply).toBe(true);
    if (d.apply) expect(d.orgId).toBe('org_real');
  });

  test('최초 생성(저장된 매핑 없음)은 metadata를 폴백으로 사용', () => {
    const d = decideBillingUpdate(change({ metadataOrgId: 'org_meta' }), null, PRICES);
    expect(d.apply).toBe(true);
    if (d.apply) expect(d.orgId).toBe('org_meta');
  });

  test('unknown customer + metadata 없음 → skip (조용히 버리지만 이유 남김)', () => {
    const d = decideBillingUpdate(change({ metadataOrgId: null }), null, PRICES);
    expect(d.apply).toBe(false);
    if (!d.apply) expect(d.reason).toContain('no org');
  });
});

describe('decideBillingUpdate — 순서/멱등 워터마크', () => {
  test('워터마크보다 오래된 이벤트는 무시 (out-of-order 재배송)', () => {
    const existing: ExistingBilling = { orgId: 'org_real', plan: 'team', watermark: 5000 };
    const d = decideBillingUpdate(change({ eventCreated: 4000 }), existing, PRICES);
    expect(d.apply).toBe(false);
    if (!d.apply) expect(d.reason).toContain('stale');
  });

  test('워터마크와 같거나 더 새로운 이벤트는 반영', () => {
    const existing: ExistingBilling = { orgId: 'org_real', plan: 'team', watermark: 5000 };
    const d = decideBillingUpdate(change({ eventCreated: 5000 }), existing, PRICES);
    expect(d.apply).toBe(true);
    if (d.apply) expect(d.watermark).toBe(5000);
  });
});

describe('decideBillingUpdate — 미지의 price 강등 방지', () => {
  test('유료 org에 매핑안된 price가 오면 free로 강등하지 않고 기존 plan 보존', () => {
    const existing: ExistingBilling = { orgId: 'org_real', plan: 'business', watermark: null };
    const d = decideBillingUpdate(
      change({ priceId: 'price_unknown_rotated' }),
      existing,
      PRICES,
    );
    expect(d.apply).toBe(true);
    if (d.apply) expect(d.plan).toBe('business'); // free로 떨어지지 않음
  });

  test('삭제 이벤트는 미지 price라도 canceled + free (구독 종료)', () => {
    const existing: ExistingBilling = { orgId: 'org_real', plan: 'business', watermark: null };
    const d = decideBillingUpdate(
      change({
        eventType: 'customer.subscription.deleted',
        priceId: 'price_unknown',
        stripeStatus: 'canceled',
      }),
      existing,
      PRICES,
    );
    expect(d.apply).toBe(true);
    if (d.apply) {
      expect(d.status).toBe('canceled');
      expect(d.plan).toBe('free');
    }
  });

  test('알려진 price는 정상 매핑', () => {
    const d = decideBillingUpdate(change({ priceId: 'price_biz' }), null, PRICES);
    expect(d.apply).toBe(true);
    if (d.apply) expect(d.plan).toBe('business');
  });

  test('미지 price + 기존 org 없음 → free (보존할 유료플랜이 없으므로 강등 아님)', () => {
    const d = decideBillingUpdate(change({ priceId: 'price_unknown' }), null, PRICES);
    expect(d.apply).toBe(true);
    if (d.apply) expect(d.plan).toBe('free');
  });

  test('미지 price + 기존 free org → free 유지 (보존 가드가 free는 안 붙듦)', () => {
    const existing: ExistingBilling = { orgId: 'o', plan: 'free', watermark: null };
    const d = decideBillingUpdate(change({ priceId: 'price_unknown' }), existing, PRICES);
    expect(d.apply).toBe(true);
    if (d.apply) expect(d.plan).toBe('free');
  });

  test('created 이벤트도 알려진 price를 정상 매핑', () => {
    const d = decideBillingUpdate(
      change({ eventType: 'customer.subscription.created', priceId: 'price_team' }),
      null,
      PRICES,
    );
    expect(d.apply).toBe(true);
    if (d.apply) {
      expect(d.plan).toBe('team');
      expect(d.status).toBe('active');
    }
  });

  test('워터마크 null(최초)은 eventCreated 무관하게 반영', () => {
    const existing: ExistingBilling = { orgId: 'o', plan: 'free', watermark: null };
    const d = decideBillingUpdate(change({ eventCreated: 1 }), existing, PRICES);
    expect(d.apply).toBe(true);
  });
});

describe('decideBillingUpdate — 기간/상태', () => {
  test('currentPeriodEnd null → Date null', () => {
    const d = decideBillingUpdate(change({ currentPeriodEnd: null }), null, PRICES);
    expect(d.apply).toBe(true);
    if (d.apply) expect(d.currentPeriodEnd).toBeNull();
  });

  test('currentPeriodEnd unix초 → 정확한 Date(ms)', () => {
    const d = decideBillingUpdate(change({ currentPeriodEnd: 1_700_000_000 }), null, PRICES);
    expect(d.apply).toBe(true);
    if (d.apply) expect(d.currentPeriodEnd?.getTime()).toBe(1_700_000_000 * 1000);
  });
});
