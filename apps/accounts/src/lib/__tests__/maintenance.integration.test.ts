// 리텐션 프루닝 — 오래된 행은 지우고, 보존 대상(미릴레이 usage·최근 행)은 남긴다.
import { describe, expect, test } from 'bun:test';
import { runRetentionPrune } from '../maintenance';

async function dbUp(): Promise<boolean> {
  try {
    const { db } = await import('../db');
    await db.execute('select 1' as never);
    return true;
  } catch {
    return false;
  }
}
const up = await dbUp();
const uniq = (p: string) => `${p}_${crypto.randomUUID().slice(0, 12)}`;
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60_000);

describe.skipIf(!up)('runRetentionPrune (integration)', () => {
  test('오래된 audit/stripe_events 삭제, 릴레이 안 된 usage·최근 행은 보존', async () => {
    const { schema } = await import('@p0/db');
    const { db } = await import('../db');
    const { eq } = await import('drizzle-orm');

    // 실제 org (usage_events가 organization FK)
    const { auth } = await import('../../features/auth');
    const { headers } = await auth.api.signUpEmail({
      body: { email: `${uniq('pr')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
      returnHeaders: true,
    });
    const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'prune org', slug: uniq('pr') },
      headers: new Headers({ cookie }),
    });
    const orgId = org!.id;

    // 오래된 audit(400일 전) + 최근 audit
    const oldAuditId = uniq('aud');
    await db.insert(schema.auditLog).values([
      { id: oldAuditId, orgId, actor: 'system', action: 'x', target: null, payload: null, ip: null, at: daysAgo(400) },
      { id: uniq('aud'), orgId, actor: 'system', action: 'y', target: null, payload: null, ip: null, at: daysAgo(1) },
    ]);

    // 오래된 stripe_event(100일 전) + 최근
    const oldEvtId = uniq('evt');
    await db.insert(schema.stripeEvents).values([
      { eventId: oldEvtId, at: daysAgo(100) },
      { eventId: uniq('evt'), at: daysAgo(1) },
    ]);

    // usage: 오래됐지만 릴레이됨 → 삭제 / 오래됐지만 미릴레이 → 보존
    const relayedOldId = uniq('use');
    const unrelayedOldId = uniq('use');
    await db.insert(schema.usageEvents).values([
      { id: relayedOldId, orgId, metric: 'ai_tokens', quantity: 1, at: daysAgo(200), idempotencyKey: uniq('k'), relayedAt: daysAgo(199) },
      { id: unrelayedOldId, orgId, metric: 'ai_tokens', quantity: 1, at: daysAgo(200), idempotencyKey: uniq('k'), relayedAt: null },
    ]);

    const result = await runRetentionPrune();
    expect(result.anyFailed).toBe(false);
    expect(result.audit.ok && result.audit.deleted).toBeGreaterThanOrEqual(1);
    expect(result.stripeEvents.ok && result.stripeEvents.deleted).toBeGreaterThanOrEqual(1);
    // usage: 릴레이된 오래된 행 1개 삭제 (미릴레이는 보존)
    expect(result.usage.ok && result.usage.deleted).toBeGreaterThanOrEqual(1);

    // 오래된 것은 사라지고
    expect((await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, oldAuditId))).length).toBe(0);
    expect((await db.select().from(schema.stripeEvents).where(eq(schema.stripeEvents.eventId, oldEvtId))).length).toBe(0);
    expect((await db.select().from(schema.usageEvents).where(eq(schema.usageEvents.id, relayedOldId))).length).toBe(0);
    // ★미릴레이 usage는 오래돼도 보존 (미청구 유실 방지)
    expect((await db.select().from(schema.usageEvents).where(eq(schema.usageEvents.id, unrelayedOldId))).length).toBe(1);
  });
});

test.skipIf(up)('⚠️ DB 미기동 — maintenance 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
