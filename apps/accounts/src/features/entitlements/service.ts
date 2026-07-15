import type { EntitlementClaims } from '@p0/contracts';
import { planReader, roleReader } from './adapters/readers';
import { computeEntitlements } from './domain/policy';

/** JWT definePayload에서 호출 — org 없는 세션은 free/member 취급 */
export async function buildClaims(input: {
  userId: string;
  orgId: string | null;
}): Promise<EntitlementClaims> {
  if (!input.orgId) {
    return { org: null, ...computeEntitlements('free', 'member') };
  }
  const [plan, role] = await Promise.all([
    planReader.planOf(input.orgId),
    roleReader.roleOf(input.userId, input.orgId),
  ]);
  return { org: input.orgId, ...computeEntitlements(plan, role ?? 'member') };
}
