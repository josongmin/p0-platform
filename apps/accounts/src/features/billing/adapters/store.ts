import { schema } from '@p0/db';
import { eq } from 'drizzle-orm';
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
  markEventProcessed: async (eventId) => {
    const inserted = await db
      .insert(schema.stripeEvents)
      .values({ eventId })
      .onConflictDoNothing({ target: schema.stripeEvents.eventId })
      .returning({ eventId: schema.stripeEvents.eventId });
    return inserted.length > 0;
  },
};
