// ✅ 크로스 feature는 전부 공개 API(index.ts) 경유 — 테이블 직접 접근 금지.
import { getMemberRole } from '../../auth';
import { getPlan } from '../../billing';
import type { PlanReader, RoleReader } from '../ports';

export const planReader: PlanReader = {
  planOf: (orgId) => getPlan(orgId),
};

export const roleReader: RoleReader = {
  roleOf: (userId, orgId) => getMemberRole(userId, orgId),
};
