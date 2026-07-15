// RED → lib/guard.ts + /v1 라우트 + auth service가 구현 대상.
// 실제 Postgres 대상 통합 테스트 — DB 없으면 skip (CI에서 필수화 예정).
import { beforeAll, describe, expect, test } from 'bun:test';
import { app } from '../../../app';
import { auth } from '../adapters/better-auth';

async function dbUp(): Promise<boolean> {
  try {
    const { db } = await import('../../../lib/db');
    await db.execute('select 1' as never);
    return true;
  } catch {
    return false;
  }
}

const up = await dbUp();

function uniq(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** 가입 후 쿠키 반환 */
async function signUp(email: string) {
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password: 'Str0ng!passw0rd', name: 'tester' },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { cookie, userId: response.user.id };
}

describe.skipIf(!up)('RBAC guards (integration)', () => {
  let ownerCookie = '';
  let orgId = '';

  beforeAll(async () => {
    const owner = await signUp(`${uniq('owner')}@p0.test`);
    ownerCookie = owner.cookie;
    const org = await auth.api.createOrganization({
      body: { name: 'p0 test org', slug: uniq('org') },
      headers: new Headers({ cookie: ownerCookie }),
    });
    orgId = org!.id;
  });

  test('비로그인 → 401', async () => {
    const res = await app.request(`/v1/billing/${orgId}`);
    expect(res.status).toBe(401);
  });

  test('비멤버 → 403', async () => {
    const stranger = await signUp(`${uniq('stranger')}@p0.test`);
    const res = await app.request(`/v1/billing/${orgId}`, {
      headers: { cookie: stranger.cookie },
    });
    expect(res.status).toBe(403);
  });

  test('owner → billing 조회 200 (free)', async () => {
    const res = await app.request(`/v1/billing/${orgId}`, {
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: string };
    expect(body.plan).toBe('free');
  });

  test('member 역할 → billing 조회 403 (billing.read 없음)', async () => {
    const m = await signUp(`${uniq('member')}@p0.test`);
    await auth.api.addMember({
      body: { userId: m.userId, organizationId: orgId, role: 'member' },
    });
    const res = await app.request(`/v1/billing/${orgId}`, {
      headers: { cookie: m.cookie },
    });
    expect(res.status).toBe(403);
  });

  test('billing 역할 → 조회 200 + checkout은 guard 통과(403 아님)', async () => {
    const b = await signUp(`${uniq('bill')}@p0.test`);
    await auth.api.addMember({
      body: { userId: b.userId, organizationId: orgId, role: 'billing' },
    });
    const read = await app.request(`/v1/billing/${orgId}`, {
      headers: { cookie: b.cookie },
    });
    expect(read.status).toBe(200);

    const checkout = await app.request(`/v1/billing/${orgId}/checkout`, {
      method: 'POST',
      headers: { cookie: b.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'team', cycle: 'monthly' }),
    });
    // Stripe 키가 없어 500은 나도 됨 — 권한 게이트(403/401)만 아니면 통과
    expect([401, 403]).not.toContain(checkout.status);
  });

  test('guest → entitlements에 쓰기 기능 제거돼 나옴', async () => {
    const g = await signUp(`${uniq('guest')}@p0.test`);
    await auth.api.addMember({
      body: { userId: g.userId, organizationId: orgId, role: 'guest' },
    });
    const res = await app.request(`/v1/entitlements/${orgId}`, {
      headers: { cookie: g.cookie },
    });
    expect(res.status).toBe(200);
    const claims = (await res.json()) as { role: string; features: string[] };
    expect(claims.role).toBe('guest');
    expect(claims.features).not.toContain('fix.pipeline');
  });

  test('서비스 키 없이 /v1/usage → 401', async () => {
    const res = await app.request('/v1/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId,
        metric: 'ai_tokens',
        quantity: 100,
        at: new Date().toISOString(),
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    expect(res.status).toBe(401);
  });
});

test.skipIf(up)('⚠️ DB 미기동 — RBAC 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
