import { schema } from '@p0/db';
import { and, count, eq } from 'drizzle-orm';
import { db } from '../../../lib/db';

/** 사용자가 '유일한 owner'인 org id 목록 — 이 사용자가 삭제되면 주인 없는 고아가 된다. */
export async function soleOwnedOrgIds(userId: string): Promise<string[]> {
  const owned = await db
    .select({ orgId: schema.member.organizationId })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.role, 'owner')));

  const sole: string[] = [];
  for (const { orgId } of owned) {
    const [row] = await db
      .select({ owners: count() })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.role, 'owner')));
    if ((row?.owners ?? 0) <= 1) sole.push(orgId);
  }
  return sole;
}

/** 사용자가 멤버인 모든 org id — 삭제 시 이들의 epoch를 무효화(cascade 멤버제거 대응). */
export async function memberOrgIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ orgId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId));
  return rows.map((r) => r.orgId);
}

/** org 삭제 — member/team/invitation/org_billing/usage는 FK cascade로 정리. */
export async function deleteOrgById(orgId: string): Promise<void> {
  await db.delete(schema.organization).where(eq(schema.organization.id, orgId));
}
