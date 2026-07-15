// 유스케이스 — domain(can) + ports(memberRoleReader) + vendor(auth) 조립.
import { auth } from './adapters/better-auth';
import { memberRoleReader } from './adapters/member-repo';
import { can, isOrgRole, type OrgRole, type Resource } from './domain/roles';

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

export type ServiceKeyResult =
  | { valid: true; orgId: string | null }
  | { valid: false; orgId: null };

/**
 * 서비스 간 호출(x-api-key) 검증 — better-auth apiKey 플러그인.
 * key.referenceId = 키 발급 시 묶은 org id. 호출자는 이 org로만 쓸 수 있어야 하므로
 * boolean이 아니라 referenceId까지 반환한다 (C1: 크로스 테넌트 쓰기 차단).
 */
export async function verifyServiceKey(key: string): Promise<ServiceKeyResult> {
  const result = await auth.api.verifyApiKey({ body: { key } });
  if (result.valid !== true) return { valid: false, orgId: null };
  const referenceId =
    (result.key as { referenceId?: string | null } | null)?.referenceId ?? null;
  return { valid: true, orgId: referenceId };
}
