// 공개 API — 밖에서는 이 파일로만 접근.
export { auth } from './adapters/better-auth';
export { authRoutes } from './routes';
export { setClaimsBuilder } from './claims';
export {
  setSeatLimitResolver,
  setOrgDeletingHandler,
  setUserDeletingHandler,
} from './hooks';
export {
  authorize,
  deleteOrgById,
  getMemberRole,
  getSession,
  memberOrgIds,
  soleOwnedOrgIds,
  verifyServiceKey,
  type AuthorizeResult,
} from './service';
export { can, isOrgRole, ORG_ROLES } from './domain/roles';
export type { ActionOf, OrgRole, Resource } from './domain/roles';
