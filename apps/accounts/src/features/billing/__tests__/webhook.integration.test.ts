// webhook 멱등·순서·customer→org 매핑을 실제 DB에서 검증 (DB 없으면 skip).
// org_billing.orgId는 organization FK라 실제 org를 만들어 쓴다.
import { describe, expect, test } from 'bun:test';
import { getStatus, handleWebhookEvent } from '../service';
import type { SubscriptionChange } from '../domain/webhook';
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

async function makeOrg(): Promise<string> {
  const { headers } = await auth.api.signUpEmail({
    body: { email: `${uniq('wh')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
    returnHeaders: true,
  });
  const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const org = await auth.api.createOrganization({
    body: { name: 'wh org', slug: uniq('wh') },
    headers: new Headers({ cookie }),
  });
  return org!.id;
}

function mk(over: Partial<SubscriptionChange>): SubscriptionChange {
  return {
    eventId: uniq('evt'),
    eventCreated: 1000,
    eventType: 'customer.subscription.updated',
    stripeCustomerId: uniq('cus'),
    stripeSubscriptionId: uniq('sub'),
    metadataOrgId: uniq('org'),
    priceId: undefined,
    stripeStatus: 'active',
    currentPeriodEnd: null,
    ...over,
  };
}

describe.skipIf(!up)('webhook 반영 (integration)', () => {
  test('멱등: 같은 event.id 재처리는 no-op', async () => {
    const orgId = await makeOrg();
    const cus = uniq('cus');
    const e1 = uniq('evt');

    await handleWebhookEvent(mk({ eventId: e1, metadataOrgId: orgId, stripeCustomerId: cus, stripeStatus: 'active', eventCreated: 1000 }));
    expect((await getStatus(orgId)).status).toBe('active');

    // 같은 event.id로 canceled 재배송 → 이미 처리됨 → 무시
    await handleWebhookEvent(mk({ eventId: e1, metadataOrgId: orgId, stripeCustomerId: cus, stripeStatus: 'canceled', eventCreated: 2000 }));
    expect((await getStatus(orgId)).status).toBe('active');

    // 새 event.id면 반영
    await handleWebhookEvent(mk({ metadataOrgId: orgId, stripeCustomerId: cus, stripeStatus: 'canceled', eventCreated: 3000 }));
    expect((await getStatus(orgId)).status).toBe('canceled');
  });

  test('순서: 워터마크보다 오래된 이벤트는 무시', async () => {
    const orgId = await makeOrg();
    const cus = uniq('cus');
    await handleWebhookEvent(mk({ metadataOrgId: orgId, stripeCustomerId: cus, stripeStatus: 'canceled', eventCreated: 5000 }));
    expect((await getStatus(orgId)).status).toBe('canceled');

    // 더 오래된(4000) active 이벤트 → stale → 무시
    await handleWebhookEvent(mk({ metadataOrgId: orgId, stripeCustomerId: cus, stripeStatus: 'active', eventCreated: 4000 }));
    expect((await getStatus(orgId)).status).toBe('canceled');
  });

  test('customer→org 매핑: 최초 저장 후엔 metadata 위조를 무시', async () => {
    const orgReal = await makeOrg();
    const cus = uniq('cus');
    await handleWebhookEvent(mk({ metadataOrgId: orgReal, stripeCustomerId: cus, stripeStatus: 'active', eventCreated: 1000 }));

    // 같은 customer인데 metadata에 다른(존재하는) org를 실어 보냄 → 원래 org로 반영돼야 함
    const orgAttacker = await makeOrg();
    await handleWebhookEvent(mk({ metadataOrgId: orgAttacker, stripeCustomerId: cus, stripeStatus: 'past_due', eventCreated: 2000 }));
    expect((await getStatus(orgReal)).status).toBe('past_due');
    // 공격자 org는 건드려지지 않음
    expect((await getStatus(orgAttacker)).status).toBe('none');
  });
});

test.skipIf(up)('⚠️ DB 미기동 — webhook 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
