// P1 회귀 — 이미 구독 중이면 checkout이 두 번째 구독을 만들지 않는다 (DB 없으면 skip).
// org_billing.orgId는 organization FK라 실제 org를 만들어 시드한다.
import { describe, expect, test } from 'bun:test';
import { cancelOrgSubscription, createCheckout } from '../service';
import { billingStore } from '../adapters/store';
import { auth } from '../../auth';

async function dbUp(): Promise<boolean> {
  try {
    const { db } = await import('../../../lib/db');
    await db.execute('select 1' as never);
    return true;
  } catch {
    return false;
  }
}
const up = await dbUp();
const uniq = (p: string) => `${p}_${crypto.randomUUID().slice(0, 12)}`;

/** 실제 user+org를 만들고 org id 반환 (FK 충족) */
async function makeOrg(): Promise<string> {
  const { headers } = await auth.api.signUpEmail({
    body: { email: `${uniq('co')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
    returnHeaders: true,
  });
  const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const org = await auth.api.createOrganization({
    body: { name: 'checkout org', slug: uniq('co') },
    headers: new Headers({ cookie }),
  });
  return org!.id;
}

describe.skipIf(!up)('createCheckout 중복구독 가드 (integration)', () => {
  test('active 구독 org → already-subscribed (portal로 유도)', async () => {
    const orgId = await makeOrg();
    await billingStore.upsert({
      orgId,
      stripeCustomerId: uniq('cus'),
      stripeSubscriptionId: uniq('sub'),
      plan: 'team',
      status: 'active',
      currentPeriodEnd: null,
      watermark: 1,
    });
    const r = await createCheckout(orgId, { plan: 'team', cycle: 'monthly' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('already-subscribed');
  });

  test('past_due/trialing도 활성으로 간주해 차단', async () => {
    for (const status of ['past_due', 'trialing'] as const) {
      const orgId = await makeOrg();
      await billingStore.upsert({
        orgId,
        stripeCustomerId: uniq('cus'),
        stripeSubscriptionId: uniq('sub'),
        plan: 'team',
        status,
        currentPeriodEnd: null,
        watermark: 1,
      });
      const r = await createCheckout(orgId, { plan: 'team', cycle: 'monthly' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('already-subscribed');
    }
  });

  test('canceled/신규 org는 상태 게이트를 통과한다 (already-subscribed 아님)', async () => {
    const orgId = await makeOrg();
    await billingStore.upsert({
      orgId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      plan: 'free',
      status: 'canceled',
      currentPeriodEnd: null,
      watermark: null,
    });
    const r = await createCheckout(orgId, { plan: 'team', cycle: 'monthly' });
    // price 설정 여부와 무관하게 already-subscribed는 아니어야 한다.
    if (r.ok) expect(r.url).toContain('stripe.com');
    else expect(r.error).toBe('no-price');
  });
});

describe.skipIf(!up)('cancelOrgSubscription (org 삭제 훅)', () => {
  test('구독 없으면 no-op (throw 안 함)', async () => {
    const orgId = await makeOrg();
    await billingStore.upsert({
      orgId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      plan: 'free',
      status: 'none',
      currentPeriodEnd: null,
      watermark: null,
    });
    await expect(cancelOrgSubscription(orgId)).resolves.toBeUndefined();
  });

  test('구독 있고 Stripe 키 없으면 catch로 삭제를 막지 않는다 (로깅만)', async () => {
    const orgId = await makeOrg();
    await billingStore.upsert({
      orgId,
      stripeCustomerId: uniq('cus'),
      stripeSubscriptionId: uniq('sub'),
      plan: 'team',
      status: 'active',
      currentPeriodEnd: null,
      watermark: 1,
    });
    // Stripe 키 미설정 → cancel이 throw하지만 cancelOrgSubscription이 삼켜서 resolve
    await expect(cancelOrgSubscription(orgId)).resolves.toBeUndefined();
  });
});

test.skipIf(up)('⚠️ DB 미기동 — checkout 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
