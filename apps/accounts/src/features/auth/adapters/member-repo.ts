import { schema } from '@p0/db';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../lib/db';
import type { MemberRoleReader } from '../ports';

export const memberRoleReader: MemberRoleReader = {
  roleOf: async (userId, orgId) => {
    const rows = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.userId, userId),
          eq(schema.member.organizationId, orgId),
        ),
      )
      .limit(1);
    return rows[0]?.role ?? null;
  },
};
