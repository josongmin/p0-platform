import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// 소유: features/audit — append-only, 수정/삭제 없음.
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    actor: text('actor').notNull(), // user id 또는 'system:stripe' 같은 시스템 주체
    action: text('action').notNull(), // 'billing.subscription.updated' 등 도메인 이벤트명
    target: text('target'),
    payload: jsonb('payload'),
    ip: text('ip'),
    at: timestamp('at').notNull().defaultNow(),
  },
  (t) => [index('audit_org_at_idx').on(t.orgId, t.at)],
);
