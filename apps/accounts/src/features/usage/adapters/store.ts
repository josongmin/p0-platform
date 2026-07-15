import { schema } from '@p0/db';
import { db } from '../../../lib/db';
import type { UsageStore } from '../ports';

export const usageStore: UsageStore = {
  insert: async (record) => {
    await db
      .insert(schema.usageEvents)
      .values(record)
      .onConflictDoNothing({ target: schema.usageEvents.idempotencyKey });
  },
};
