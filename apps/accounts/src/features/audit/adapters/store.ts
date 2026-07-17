import { schema } from '@p0/db';
import { desc, eq, lt } from 'drizzle-orm';
import { db } from '../../../lib/db';
import type { AuditStore } from '../ports';

export const auditStore: AuditStore = {
  append: async (entry) => {
    await db.insert(schema.auditLog).values(entry);
  },
  list: async (orgId, { limit }) => {
    return db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.orgId, orgId))
      .orderBy(desc(schema.auditLog.at))
      .limit(limit);
  },
  pruneBefore: async (cutoff) => {
    const deleted = await db
      .delete(schema.auditLog)
      .where(lt(schema.auditLog.at, cutoff))
      .returning({ id: schema.auditLog.id });
    return deleted.length;
  },
};
