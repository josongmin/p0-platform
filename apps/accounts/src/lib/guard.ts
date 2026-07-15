// HTTP 가드 — auth feature의 공개 API 위에 얹힌 hono 미들웨어 3종.
import { createMiddleware } from 'hono/factory';
import {
  authorize,
  getSession,
  verifyServiceKey,
  type OrgRole,
  type Resource,
} from '../features/auth';

export type GuardEnv = {
  Variables: {
    userId: string;
    orgId: string;
    role: OrgRole;
  };
};

// 서비스 키 인증 컨텍스트 — 키에 묶인 org id (null = 전역 키)
export type ServiceEnv = {
  Variables: {
    serviceOrgId: string | null;
  };
};

const unauthorized = { kind: 'unauthorized', message: 'sign in required' } as const;
const forbidden = { kind: 'forbidden', message: 'forbidden' } as const;

/** 로그인만 요구 */
export const requireSession = createMiddleware<GuardEnv>(async (c, next) => {
  const session = await getSession(c.req.raw.headers);
  if (!session) return c.json(unauthorized, 401);
  c.set('userId', session.user.id);
  await next();
});

/** org 멤버십 요구 (역할 무관) — :orgId 파라미터 기준 */
export function requireMember(orgParam = 'orgId') {
  return guard(orgParam);
}

/** 권한 매트릭스 검사 — can(role, resource, action) */
export function requirePermission(
  resource: Resource,
  action: string,
  orgParam = 'orgId',
) {
  return guard(orgParam, resource, action);
}

function guard(orgParam: string, resource?: Resource, action?: string) {
  return createMiddleware<GuardEnv>(async (c, next) => {
    const session = await getSession(c.req.raw.headers);
    if (!session) return c.json(unauthorized, 401);

    const orgId = c.req.param(orgParam);
    if (!orgId) {
      return c.json({ kind: 'validation', message: `missing :${orgParam}` }, 400);
    }

    const result = await authorize({
      userId: session.user.id,
      orgId,
      resource,
      action,
    });
    if (!result.allowed) return c.json(forbidden, 403);

    c.set('userId', session.user.id);
    c.set('orgId', orgId);
    c.set('role', result.role);
    await next();
  });
}

/** 서비스 간 호출 — x-api-key 헤더 (better-auth apiKey 플러그인) */
export const requireServiceKey = createMiddleware<ServiceEnv>(async (c, next) => {
  const key = c.req.header('x-api-key');
  if (!key) return c.json(unauthorized, 401);
  // 검증 자체가 던지면(DB 다운 등) 401이 아니라 503으로 구분 — on-call 오인 방지
  let result: Awaited<ReturnType<typeof verifyServiceKey>>;
  try {
    result = await verifyServiceKey(key);
  } catch (e) {
    console.error('[guard] service key verify failed:', e);
    return c.json({ kind: 'http', message: 'key verification unavailable' }, 503);
  }
  if (!result.valid) return c.json(unauthorized, 401);
  c.set('serviceOrgId', result.orgId);
  await next();
});
