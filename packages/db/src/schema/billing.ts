import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './auth';

// 소유: features/billing — 다른 feature는 billing의 공개 API로만 읽는다.
// org 삭제 시 cascade — 고아 billing row + 죽은 customer 부활 방지.
// ⚠️ org 삭제 전 Stripe 구독을 반드시 취소할 것 (delete-hook TODO): 안 그러면
// 삭제 후 도착한 webhook이 존재하지 않는 org로 upsert 시도 → FK 위반.
export const orgBilling = pgTable('org_billing', {
  orgId: text('org_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  plan: text('plan').notNull().default('free'),
  status: text('status').notNull().default('none'),
  currentPeriodEnd: timestamp('current_period_end'),
  // 마지막으로 반영한 Stripe 이벤트의 created(unix초) — 순서 역전 방지 워터마크
  watermark: bigint('watermark', { mode: 'number' }),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// webhook 멱등 — 처리한 event.id 기록. Stripe 재시도/중복 배송을 걸러낸다.
export const stripeEvents = pgTable('stripe_events', {
  eventId: text('event_id').primaryKey(),
  at: timestamp('at').notNull().defaultNow(),
});
