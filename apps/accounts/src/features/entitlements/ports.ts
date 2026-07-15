import type { OrgRole, PlanId } from './domain/types';

// hex 포트 — domain이 바깥세상에 요구하는 것.
export interface PlanReader {
  planOf(orgId: string): Promise<PlanId>;
}

export interface RoleReader {
  roleOf(userId: string, orgId: string): Promise<OrgRole | null>;
}
