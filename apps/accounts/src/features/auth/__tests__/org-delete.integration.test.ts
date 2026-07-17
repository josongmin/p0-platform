// org 삭제 → beforeDeleteOrganization 훅(Stripe 취소, 구독없으면 no-op) + org_billing
// FK cascade 정리 (DB 없으면 skip).
import { beforeAll, describe, expect, test } from 'bun:test';
import { auth } from '../adapters/better-auth';

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
const uniq = (p: string) => `${p}_${crypto.randomUUID().slice(0, 8)}`;

describe.skipIf(!up)('org deletion (integration)', () => {
  let ownerCookie = '';
  let orgId = '';

  beforeAll(async () => {
    const { headers } = await auth.api.signUpEmail({
      body: { email: `${uniq('del')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
      returnHeaders: true,
    });
    ownerCookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'del org', slug: uniq('del') },
      headers: new Headers({ cookie: ownerCookie }),
    });
    orgId = org!.id;
  });

  test('org 삭제 시 org_billing이 cascade 정리되고 훅이 throw하지 않는다', async () => {
    const { schema } = await import('@p0/db');
    const { db } = await import('../../../lib/db');
    const { eq } = await import('drizzle-orm');
    const { billingStore } = await import('../../billing/adapters/store');

    // 구독 없는 billing row 세팅 (cancelOrgSubscription은 no-op이어야)
    await billingStore.upsert({
      orgId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      plan: 'free',
      status: 'none',
      currentPeriodEnd: null,
      watermark: null,
    });
    expect((await db.select().from(schema.orgBilling).where(eq(schema.orgBilling.orgId, orgId))).length).toBe(1);

    // 삭제 — beforeDeleteOrganization 훅 실행(no-op) + cascade
    await auth.api.deleteOrganization({
      body: { organizationId: orgId },
      headers: new Headers({ cookie: ownerCookie }),
    });

    // org_billing이 FK cascade로 사라졌는지
    expect((await db.select().from(schema.orgBilling).where(eq(schema.orgBilling.orgId, orgId))).length).toBe(0);
  });
});

test.skipIf(up)('⚠️ DB 미기동 — org-delete 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
