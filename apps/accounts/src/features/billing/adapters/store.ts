import { schema } from '@p0/db';
import { eq, lt } from 'drizzle-orm';
import { db } from '../../../lib/db';
import type { BillingRow, BillingStore } from '../ports';

export const billingStore: BillingStore = {
  get: async (orgId) => {
    const rows = await db
      .select()
      .from(schema.orgBilling)
      .where(eq(schema.orgBilling.orgId, orgId))
      .limit(1);
    return rows[0] ?? null;
  },
  getByCustomerId: async (customerId) => {
    const rows = await db
      .select()
      .from(schema.orgBilling)
      .where(eq(schema.orgBilling.stripeCustomerId, customerId))
      .limit(1);
    return rows[0] ?? null;
  },
  upsert: async (row: BillingRow) => {
    await db
      .insert(schema.orgBilling)
      .values(row)
      .onConflictDoUpdate({
        target: schema.orgBilling.orgId,
        set: { ...row, updatedAt: new Date() },
      });
  },
  applyWebhook: async (eventId, row) => {
    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.stripeEvents)
        .values({ eventId })
        .onConflictDoNothing({ target: schema.stripeEvents.eventId })
        .returning({ eventId: schema.stripeEvents.eventId });
      if (inserted.length === 0) return false; // 중복 배송
      await tx
        .insert(schema.orgBilling)
        .values(row)
        .onConflictDoUpdate({
          target: schema.orgBilling.orgId,
          set: { ...row, updatedAt: new Date() },
        });
      return true;
    });
  },
  markEventProcessed: async (eventId) => {
    const inserted = await db
      .insert(schema.stripeEvents)
      .values({ eventId })
      .onConflictDoNothing({ target: schema.stripeEvents.eventId })
      .returning({ eventId: schema.stripeEvents.eventId });
    return inserted.length > 0;
  },
  pruneEventsBefore: async (cutoff) => {
    const deleted = await db
      .delete(schema.stripeEvents)
      .where(lt(schema.stripeEvents.at, cutoff))
      .returning({ eventId: schema.stripeEvents.eventId });
    return deleted.length;
  },
};
