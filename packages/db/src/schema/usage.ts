import { sql } from 'drizzle-orm';
import { bigint, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './auth';

// 소유: features/usage. org 삭제 시 cascade (고아 usage row 방지).
export const usageEvents = pgTable(
  'usage_events',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    quantity: bigint('quantity', { mode: 'number' }).notNull(),
    at: timestamp('at').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    // Stripe meter로 릴레이 완료 시각 (null = 미릴레이)
    relayedAt: timestamp('relayed_at'),
    // Stripe 전송을 처음 시도한 시각. 전송 직전 기록해, 마킹 실패로 relayedAt이 안 남았을 때
    // Stripe 멱등 윈도우(24h) 밖에서 재전송해 이중청구하는 걸 막는 격리(quarantine) 기준.
    relayAttemptedAt: timestamp('relay_attempted_at'),
  },
  // 릴레이 배치의 money 쿼리(relayedAt IS NULL ORDER BY at) 부분 인덱스 — 미릴레이 행만
  // 색인해 작고, ORDER BY at 정렬을 인덱스로 충족(full scan/sort 방지).
  (t) => [
    index('usage_unrelayed_idx')
      .on(t.at)
      .where(sql`${t.relayedAt} is null`),
  ],
);
