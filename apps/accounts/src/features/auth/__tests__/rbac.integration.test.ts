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
    // 이 스위트는 여러 역할 멤버를 한 org에 추가한다 → 시트강제(free=3석)에 걸리므로
    // 좌석 넉넉한 business(100석)로 시드. status=none 유지(checkout 테스트 영향 없음).
    const { billingStore } = await import('../../billing/adapters/store');
    await billingStore.upsert({
      orgId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      plan: 'business',
      status: 'none',
      currentPeriodEnd: null,
      watermark: null,
    });
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

  test('owner → billing 조회 200 (신규 org는 free 기본)', async () => {
    // 공유 org는 business로 시드했으므로 free 기본값 검증은 새 org로.
    const freshOwner = await signUp(`${uniq('freshowner')}@p0.test`);
    const freshOrg = await auth.api.createOrganization({
      body: { name: 'fresh org', slug: uniq('fresh') },
      headers: new Headers({ cookie: freshOwner.cookie }),
    });
    const res = await app.request(`/v1/billing/${freshOrg!.id}`, {
      headers: { cookie: freshOwner.cookie },
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

  test('★크로스-org(IDOR): org A 소유자가 org B 리소스 접근 → 403', async () => {
    const owner2 = await signUp(`${uniq('owner2')}@p0.test`);
    const org2 = await auth.api.createOrganization({
      body: { name: 'other org', slug: uniq('org2') },
      headers: new Headers({ cookie: owner2.cookie }),
    });
    // org1의 owner가 org2의 billing을 조회 시도 → org2 멤버가 아니므로 403
    const res = await app.request(`/v1/billing/${org2!.id}`, {
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(403);
  });

  test('★DB에 알 수 없는 role이 있으면 락아웃(403) — 권한 상승 아님', async () => {
    const u = await signUp(`${uniq('rogue')}@p0.test`);
    const { schema } = await import('@p0/db');
    const { db } = await import('../../../lib/db');
    // 매트릭스에 없는 role을 직접 심음 (better-auth 우회)
    await db.insert(schema.member).values({
      id: `mem_${crypto.randomUUID().slice(0, 12)}`,
      organizationId: orgId,
      userId: u.userId,
      role: 'superhacker',
      createdAt: new Date(),
    });
    const res = await app.request(`/v1/billing/${orgId}`, {
      headers: { cookie: u.cookie },
    });
    expect(res.status).toBe(403);
  });

  test('checkout: billing 권한 통과 → 게이트(401/403) 아님 (price 설정 여부와 무관)', async () => {
    const b = await signUp(`${uniq('bill2')}@p0.test`);
    await auth.api.addMember({
      body: { userId: b.userId, organizationId: orgId, role: 'billing' },
    });
    const res = await app.request(`/v1/billing/${orgId}/checkout`, {
      method: 'POST',
      headers: { cookie: b.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'team', cycle: 'monthly' }),
    });
    // price 있으면 200(url), 없으면 400(no-price) — 둘 다 권한 게이트는 통과한 것
    expect([401, 403]).not.toContain(res.status);
  });
});

// C2(test): CI에서는 DB가 반드시 떠 있어야 한다 — skip으로 보안 스위트가 조용히 증발 금지
test('보안 통합 스위트 실행 보장 (CI에선 DB 필수)', async () => {
  const { env } = await import('../../../lib/env');
  if (env.CI) expect(up).toBe(true);
  else expect(typeof up).toBe('boolean');
});
