// 유스케이스 — domain(can) + ports(memberRoleReader) + vendor(auth) 조립.
import { auth } from './adapters/better-auth';
import { memberRoleReader } from './adapters/member-repo';
import { deleteOrgById, memberOrgIds, soleOwnedOrgIds } from './adapters/org-repo';
import { can, isOrgRole, type OrgRole, type Resource } from './domain/roles';
import { extractKeyOrgId } from './domain/service-key';

export { deleteOrgById, memberOrgIds, soleOwnedOrgIds };

export async function getSession(headers: Headers) {
  return auth.api.getSession({ headers });
}

export async function getMemberRole(
  userId: string,
  orgId: string,
): Promise<OrgRole | null> {
  const role = await memberRoleReader.roleOf(userId, orgId);
  return isOrgRole(role) ? role : null;
}

export type AuthorizeResult =
  | { allowed: true; role: OrgRole }
  | { allowed: false; reason: 'not-member' | 'denied' };

/** 가드의 단일 진입점: 멤버십 확인 + (옵션) 권한 매트릭스 검사 */
export async function authorize(input: {
  userId: string;
  orgId: string;
  resource?: Resource;
  action?: string;
}): Promise<AuthorizeResult> {
  const role = await getMemberRole(input.userId, input.orgId);
  if (!role) return { allowed: false, reason: 'not-member' };
  if (input.resource && input.action && !can(role, input.resource, input.action)) {
    return { allowed: false, reason: 'denied' };
  }
  return { allowed: true, role };
}

type ServiceKeyResult =
  | { valid: true; orgId: string | null }
  | { valid: false; orgId: null };

/**
 * 서비스 간 호출(x-api-key) 검증 — better-auth apiKey 플러그인.
 * 서비스 키는 발급 시 metadata.orgId 로 org에 묶는다 (enableMetadata). 이 orgId만
 * 사용량을 기록할 수 있다 (C1: 크로스 테넌트 쓰기 차단).
 * 주의: referenceId는 기본 references:"user"라 userId → org 스코핑에 못 씀. metadata를 쓴다.
 */
export async function verifyServiceKey(key: string): Promise<ServiceKeyResult> {
  const result = await auth.api.verifyApiKey({ body: { key } });
  if (result.valid !== true) return { valid: false, orgId: null };
  const metadata = (result.key as { metadata?: unknown } | null)?.metadata;
  return { valid: true, orgId: extractKeyOrgId(metadata) };
}
