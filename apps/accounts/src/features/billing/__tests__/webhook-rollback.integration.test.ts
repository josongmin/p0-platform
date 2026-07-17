// R3 원자성 회귀 — applyWebhook의 upsert가 실패하면 event.id 기록도 롤백돼야 한다
// (안 그러면 재시도가 "이미 처리됨"으로 스킵돼 결제변경 영구 유실). DB 없으면 skip.
// 유도 방법: 존재하지 않는 orgId로 upsert → org_billing FK 위반 → 트랜잭션 롤백.
import { describe, expect, test } from 'bun:test';
import { billingStore } from '../adapters/store';

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

describe.skipIf(!up)('applyWebhook 트랜잭션 원자성 (integration)', () => {
  test('★upsert 실패 시 event.id 기록이 롤백된다 → 재시도가 다시 처리 가능', async () => {
    const eventId = uniq('evt');
    const badRow = {
      orgId: uniq('nonexistent_org'), // FK 위반 유발 (organization에 없음)
      stripeCustomerId: uniq('cus'),
      stripeSubscriptionId: uniq('sub'),
      plan: 'team',
      status: 'active',
      currentPeriodEnd: null,
      watermark: 1,
    };

    // 1차: upsert가 FK 위반으로 throw → 트랜잭션 전체 롤백
    await expect(billingStore.applyWebhook(eventId, badRow)).rejects.toThrow();

    // 검증: event.id가 stripe_events에 남지 않았어야 한다 (롤백됨).
    // → 같은 eventId로 다시 시도하면 "이미 처리됨(false)"이 아니라 다시 upsert를 탄다.
    //   (여전히 FK 위반이지만, 중요한 건 "fresh로 인식되어 재처리를 시도한다"는 것)
    const { schema } = await import('@p0/db');
    const { db } = await import('../../../lib/db');
    const { eq } = await import('drizzle-orm');
    const rows = await db
      .select()
      .from(schema.stripeEvents)
      .where(eq(schema.stripeEvents.eventId, eventId));
    expect(rows.length).toBe(0); // 롤백되어 흔적 없음
  });

  test('정상 org면 applyWebhook가 true(적용)·중복은 false', async () => {
    const { auth } = await import('../../auth');
    const { headers } = await auth.api.signUpEmail({
      body: { email: `${uniq('rb')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
      returnHeaders: true,
    });
    const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'rb org', slug: uniq('rb') },
      headers: new Headers({ cookie }),
    });
    const eventId = uniq('evt');
    const row = {
      orgId: org!.id,
      stripeCustomerId: uniq('cus'),
      stripeSubscriptionId: uniq('sub'),
      plan: 'team',
      status: 'active',
      currentPeriodEnd: null,
      watermark: 1,
    };
    expect(await billingStore.applyWebhook(eventId, row)).toBe(true); // fresh
    expect(await billingStore.applyWebhook(eventId, row)).toBe(false); // dup
  });
});

test.skipIf(up)('⚠️ DB 미기동 — webhook-rollback 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
