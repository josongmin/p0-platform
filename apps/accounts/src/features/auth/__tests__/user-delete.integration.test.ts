// C1 회귀 — 사용자 삭제 시 단독소유 org의 구독 취소 + org 삭제 (고아·유령구독 방지).
// test-preload가 app.ts를 import하므로 setUserDeletingHandler는 실제 핸들러로 배선됨.
import { describe, expect, test } from 'bun:test';
import { auth } from '../adapters/better-auth';
import { runUserDeleting } from '../hooks';

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

describe.skipIf(!up)('user deletion → sole-owned org cleanup (integration)', () => {
  test('★단독소유 org는 사용자 삭제 시 구독취소+삭제된다', async () => {
    const { schema } = await import('@p0/db');
    const { db } = await import('../../../lib/db');
    const { eq } = await import('drizzle-orm');
    const { billingStore } = await import('../../billing/adapters/store');

    // 소유자 + org
    const { headers, response } = await auth.api.signUpEmail({
      body: { email: `${uniq('ud')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
      returnHeaders: true,
    });
    const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'ud org', slug: uniq('ud') },
      headers: new Headers({ cookie }),
    });
    const orgId = org!.id;
    // 구독 있는 billing row (Stripe 키 없어 cancel은 catch되지만 org 삭제는 진행)
    await billingStore.upsert({
      orgId,
      stripeCustomerId: uniq('cus'),
      stripeSubscriptionId: uniq('sub'),
      plan: 'team',
      status: 'active',
      currentPeriodEnd: null,
      watermark: 1,
    });

    // beforeDelete 훅 경로를 직접 구동 (이메일 확인 플로우 우회)
    await runUserDeleting(response.user.id);

    // org가 삭제되고 org_billing이 cascade로 사라졌는지
    expect((await db.select().from(schema.organization).where(eq(schema.organization.id, orgId))).length).toBe(0);
    expect((await db.select().from(schema.orgBilling).where(eq(schema.orgBilling.orgId, orgId))).length).toBe(0);
  });

  test('공동소유(owner 2명) org는 한 명 삭제해도 보존된다', async () => {
    const { schema } = await import('@p0/db');
    const { db } = await import('../../../lib/db');
    const { eq } = await import('drizzle-orm');

    const a = await auth.api.signUpEmail({
      body: { email: `${uniq('co')}@p0.test`, password: 'Str0ng!passw0rd', name: 'a' },
      returnHeaders: true,
    });
    const cookieA = a.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'co org', slug: uniq('co') },
      headers: new Headers({ cookie: cookieA }),
    });
    const orgId = org!.id;
    // 두 번째 owner 추가
    const b = await auth.api.signUpEmail({
      body: { email: `${uniq('co')}@p0.test`, password: 'Str0ng!passw0rd', name: 'b' },
      returnHeaders: true,
    });
    await auth.api.addMember({
      body: { userId: b.response.user.id, organizationId: orgId, role: 'owner' },
    });

    // a 삭제 → 공동소유라 org 보존
    await runUserDeleting(a.response.user.id);
    expect((await db.select().from(schema.organization).where(eq(schema.organization.id, orgId))).length).toBe(1);
  });
});

test.skipIf(up)('⚠️ DB 미기동 — user-delete 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
