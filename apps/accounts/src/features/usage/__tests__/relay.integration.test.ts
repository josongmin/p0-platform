// 릴레이 오케스트레이션 — Stripe 키 없이 검증 가능한 경로 (free=마킹, no-meter=보류).
// 실제 Stripe 전송은 e2e 하네스(테스트키 필요)에서. DB 없으면 skip.
import { beforeAll, describe, expect, test } from 'bun:test';
import { relayUsage } from '../service';

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
  const { auth } = await import('../../auth');
  const { headers } = await auth.api.signUpEmail({
    body: { email: `${uniq('rl')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
    returnHeaders: true,
  });
  const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const org = await auth.api.createOrganization({
    body: { name: 'relay org', slug: uniq('rl') },
    headers: new Headers({ cookie }),
  });
  return org!.id;
}

describe.skipIf(!up)('relayUsage — 비청구/무결성 경로 (integration)', () => {
  // relayUsage(limit=500)는 전역 미릴레이 행을 훑는다. 공유 테스트 DB에 누적된 다른
  // 테스트의 usage 행이 쌓이면 org별 getCustomerId 조회로 배치가 5s를 넘겨 timeout →
  // 이 파일 시작 시 정리해 격리(파일들은 순차 실행이라 안전).
  beforeAll(async () => {
    const { db } = await import('../../../lib/db');
    const { schema } = await import('@p0/db');
    await db.delete(schema.usageEvents);
  });

  test('★고객 없음 + 유예 내(신규)는 defer-no-customer — 영구 write-off 안 함', async () => {
    const orgId = await makeOrg(); // billing 행 없음 = 고객 없음
    const { db } = await import('../../../lib/db');
    const { schema } = await import('@p0/db');
    const { eq } = await import('drizzle-orm');
    const usageId = uniq('use');
    await db.insert(schema.usageEvents).values({
      id: usageId, orgId, metric: 'ai_tokens', quantity: 100,
      at: new Date(), // 방금 = 유예 내
      idempotencyKey: uniq('k'), relayedAt: null,
    });

    const result = await relayUsage();
    expect(result.deferredNoCustomer).toBeGreaterThanOrEqual(1);
    // 미릴레이 유지 (웹훅이 고객 붙이면 그때 릴레이 — 유실 방지)
    const [row] = await db
      .select({ relayedAt: schema.usageEvents.relayedAt })
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.id, usageId));
    expect(row?.relayedAt).toBeNull();
  });

  test('고객 없음 + 유예 초과(4일)는 mark-nonbillable → 프루닝 대상화', async () => {
    const orgId = await makeOrg();
    const { db } = await import('../../../lib/db');
    const { schema } = await import('@p0/db');
    const { eq } = await import('drizzle-orm');
    const usageId = uniq('use');
    await db.insert(schema.usageEvents).values({
      id: usageId, orgId, metric: 'ai_tokens', quantity: 100,
      at: new Date(Date.now() - 4 * 24 * 60 * 60_000), // 유예(3일) 초과
      idempotencyKey: uniq('k'), relayedAt: null,
    });

    const result = await relayUsage();
    expect(result.markedNonBillable).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select({ relayedAt: schema.usageEvents.relayedAt })
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.id, usageId));
    expect(row?.relayedAt).not.toBeNull();
  });

  test('★double-billing 방지: 같은 이벤트를 2회 relay해도 Stripe 전송은 1회뿐', async () => {
    const orgId = await makeOrg();
    const { db } = await import('../../../lib/db');
    const { schema } = await import('@p0/db');
    const { eq } = await import('drizzle-orm');
    const usageId = uniq('use');
    const key = uniq('k'); // identifier = 이 행의 idempotencyKey
    await db.insert(schema.usageEvents).values({
      id: usageId, orgId, metric: 'ai_tokens', quantity: 100,
      at: new Date(), idempotencyKey: key, relayedAt: null,
    });

    // 주입 fake: 이 org만 고객 있음(다른 테스트 행 오염 방지), 전송 identifier 기록
    const sent: string[] = [];
    const deps = {
      getCustomerId: async (oid: string) => (oid === orgId ? 'cus_fake' : null),
      recordMeterEvent: async (e: { identifier: string }) => { sent.push(e.identifier); },
      mapping: { ai_tokens: 'mtr_ai' },
    };

    await relayUsage(500, deps);
    // 이 행이 정확히 1번 전송되고 relayed 마킹됨
    expect(sent.filter((id) => id === key)).toHaveLength(1);
    const [row1] = await db
      .select({ relayedAt: schema.usageEvents.relayedAt })
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.id, usageId));
    expect(row1?.relayedAt).not.toBeNull();

    // 2회차: 이미 relayed → listRelayable에서 제외 → 재전송 0 (여전히 1번)
    await relayUsage(500, deps);
    expect(sent.filter((id) => id === key)).toHaveLength(1);
  });

  test('고객 있고 meter 미설정 → defer (미릴레이 유지, 유실 안 함)', async () => {
    const orgId = await makeOrg();
    const { db } = await import('../../../lib/db');
    const { schema } = await import('@p0/db');
    const { eq } = await import('drizzle-orm');

    const usageId = uniq('use');
    await db.insert(schema.usageEvents).values({
      id: usageId, orgId, metric: 'ai_tokens', quantity: 100,
      at: new Date(), idempotencyKey: uniq('k'), relayedAt: null,
    });

    // 고객은 있지만 meter 매핑 없음(빈 mapping 주입) → env의 실제 meter 설정과 무관하게
    // defer-no-meter 경로를 결정적으로 검증.
    const deps = {
      getCustomerId: async () => 'cus_present',
      recordMeterEvent: async () => {},
      mapping: {},
    };
    const result = await relayUsage(500, deps);
    expect(result.deferredNoMeter).toBeGreaterThanOrEqual(1);
    // 미릴레이 유지 (유실 방지)
    const [row] = await db
      .select({ relayedAt: schema.usageEvents.relayedAt })
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.id, usageId));
    expect(row?.relayedAt).toBeNull();
  });

  test('★35일 초과 이벤트는 드롭(마킹) — Stripe 거부 무한재시도·이중청구 방지', async () => {
    const orgId = await makeOrg();
    const { billingStore } = await import('../../billing/adapters/store');
    const { db } = await import('../../../lib/db');
    const { schema } = await import('@p0/db');
    const { eq } = await import('drizzle-orm');
    await billingStore.upsert({
      orgId,
      stripeCustomerId: uniq('cus'),
      stripeSubscriptionId: uniq('sub'),
      plan: 'team',
      status: 'active',
      currentPeriodEnd: null,
      watermark: 1,
    });
    const usageId = uniq('use');
    await db.insert(schema.usageEvents).values({
      id: usageId,
      orgId,
      metric: 'ai_tokens',
      quantity: 100,
      at: new Date(Date.now() - 40 * 24 * 60 * 60_000), // 40일 전
      idempotencyKey: uniq('k'),
      relayedAt: null,
    });
    const result = await relayUsage();
    expect(result.droppedTooOld).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select({ relayedAt: schema.usageEvents.relayedAt })
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.id, usageId));
    expect(row?.relayedAt).not.toBeNull(); // 드롭 마킹됨
  });
});

test.skipIf(up)('⚠️ DB 미기동 — relay 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
