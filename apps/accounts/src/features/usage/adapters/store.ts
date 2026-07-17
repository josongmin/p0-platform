import { schema } from '@p0/db';
import { and, asc, count, gte, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db } from '../../../lib/db';
import type { UsageStore } from '../ports';

export const usageStore: UsageStore = {
  insert: async (record) => {
    await db
      .insert(schema.usageEvents)
      .values(record)
      .onConflictDoNothing({ target: schema.usageEvents.idempotencyKey });
  },
  listRelayable: async (limit, attemptCutoff) => {
    return db
      .select({
        id: schema.usageEvents.id,
        orgId: schema.usageEvents.orgId,
        metric: schema.usageEvents.metric,
        quantity: schema.usageEvents.quantity,
        at: schema.usageEvents.at,
        idempotencyKey: schema.usageEvents.idempotencyKey,
      })
      .from(schema.usageEvents)
      .where(
        and(
          isNull(schema.usageEvents.relayedAt),
          // 미시도 OR 최근 시도(멱등 윈도우 내) → 재전송 안전. 오래된 시도는 격리.
          or(
            isNull(schema.usageEvents.relayAttemptedAt),
            gte(schema.usageEvents.relayAttemptedAt, attemptCutoff),
          ),
        ),
      )
      .orderBy(asc(schema.usageEvents.at))
      .limit(limit);
  },
  markAttempted: async (ids, at) => {
    if (ids.length === 0) return;
    // 첫 시도만 기록(격리 기준은 최초 시도 시각) — 이미 있으면 유지.
    await db
      .update(schema.usageEvents)
      .set({ relayAttemptedAt: at })
      .where(
        and(
          inArray(schema.usageEvents.id, ids),
          isNull(schema.usageEvents.relayAttemptedAt),
        ),
      );
  },
  markRelayed: async (ids, at) => {
    if (ids.length === 0) return;
    await db
      .update(schema.usageEvents)
      .set({ relayedAt: at })
      .where(inArray(schema.usageEvents.id, ids));
  },
  countQuarantined: async (attemptCutoff) => {
    const rows = await db
      .select({ n: count() })
      .from(schema.usageEvents)
      .where(
        and(
          isNull(schema.usageEvents.relayedAt),
          isNotNull(schema.usageEvents.relayAttemptedAt),
          lt(schema.usageEvents.relayAttemptedAt, attemptCutoff),
        ),
      );
    return rows[0]?.n ?? 0;
  },
  pruneRelayedBefore: async (cutoff) => {
    // 릴레이 안 된 이벤트는 절대 삭제 안 함 (미청구 유실 방지).
    const deleted = await db
      .delete(schema.usageEvents)
      .where(
        and(isNotNull(schema.usageEvents.relayedAt), lt(schema.usageEvents.at, cutoff)),
      )
      .returning({ id: schema.usageEvents.id });
    return deleted.length;
  },
};
