import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// 소유: features/usage
export const usageEvents = pgTable('usage_events', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  metric: text('metric').notNull(),
  quantity: bigint('quantity', { mode: 'number' }).notNull(),
  at: timestamp('at').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  // Stripe meter로 릴레이 완료 시각 (null = 미릴레이)
  relayedAt: timestamp('relayed_at'),
});
