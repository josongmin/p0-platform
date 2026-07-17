import { schema } from '@p0/db';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../lib/db';

/** org epoch 읽기 — 행 없으면 0. */
export async function readEpoch(orgId: string): Promise<number> {
  const [row] = await db
    .select({ epoch: schema.orgEpoch.epoch })
    .from(schema.orgEpoch)
    .where(eq(schema.orgEpoch.orgId, orgId))
    .limit(1);
  return row?.epoch ?? 0;
}

/** epoch 원자적 증가 (upsert). 반환 = 새 epoch. */
export async function bumpEpoch(orgId: string): Promise<number> {
  const [row] = await db
    .insert(schema.orgEpoch)
    .values({ orgId, epoch: 1 })
    .onConflictDoUpdate({
      target: schema.orgEpoch.orgId,
      set: { epoch: sql`${schema.orgEpoch.epoch} + 1`, updatedAt: new Date() },
    })
    .returning({ epoch: schema.orgEpoch.epoch });
  return row?.epoch ?? 1;
}
