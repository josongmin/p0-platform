// epoch — stale 판정(순수) + bump/read/claim(통합).
import { describe, expect, test } from 'bun:test';
import { isEntitlementStale } from '@p0/contracts';

describe('isEntitlementStale (제품 API용 순수 헬퍼)', () => {
  test('토큰 epoch < 현재 → stale', () => {
    expect(isEntitlementStale(3, 4)).toBe(true);
  });
  test('토큰 epoch >= 현재 → fresh', () => {
    expect(isEntitlementStale(4, 4)).toBe(false);
    expect(isEntitlementStale(5, 4)).toBe(false);
  });
  test('★epoch 클레임 없음/비정수(구버전 토큰·위조) → stale (fail-safe)', () => {
    expect(isEntitlementStale(undefined, 0)).toBe(true);
    expect(isEntitlementStale(null, 5)).toBe(true);
    expect(isEntitlementStale(Number.NaN, 5)).toBe(true);
    expect(isEntitlementStale(1.5 as unknown as number, 5)).toBe(true);
  });
});

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
const uniq = (p: string) => `${p}_${crypto.randomUUID().slice(0, 8)}`;

describe.skipIf(!up)('epoch bump/read + claim (integration)', () => {
  test('새 org epoch=0, bump하면 증가, buildClaims에 실린다', async () => {
    const { auth } = await import('../../auth');
    const { currentEpoch, bumpOrgEpoch, buildClaims } = await import('../service');
    const { headers, response } = await auth.api.signUpEmail({
      body: { email: `${uniq('ep')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
      returnHeaders: true,
    });
    const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'ep org', slug: uniq('ep') },
      headers: new Headers({ cookie }),
    });
    const orgId = org!.id;
    await new Promise((r) => setTimeout(r, 150)); // 생성 시 owner-추가 bump 정착 대기

    // 초기 epoch(생성으로 bump됐을 수 있음)와 무관하게 bump는 정확히 +1, claim에 반영
    const e0 = await currentEpoch(orgId);
    const claims0 = await buildClaims({ userId: response.user.id, orgId });
    expect(claims0.epoch).toBe(e0);

    await bumpOrgEpoch(orgId);
    expect(await currentEpoch(orgId)).toBe(e0 + 1);
    const claims1 = await buildClaims({ userId: response.user.id, orgId });
    expect(claims1.epoch).toBe(e0 + 1);
  });

  test('★멤버 추가 시 버스 이벤트로 epoch가 자동 bump된다 (stale화)', async () => {
    const { auth } = await import('../../auth');
    const { currentEpoch } = await import('../service');
    const owner = await auth.api.signUpEmail({
      body: { email: `${uniq('epm')}@p0.test`, password: 'Str0ng!passw0rd', name: 'o' },
      returnHeaders: true,
    });
    const cookie = owner.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'epm org', slug: uniq('epm') },
      headers: new Headers({ cookie }),
    });
    const orgId = org!.id;
    const before = await currentEpoch(orgId);

    const m = await auth.api.signUpEmail({
      body: { email: `${uniq('epm')}@p0.test`, password: 'Str0ng!passw0rd', name: 'm' },
      returnHeaders: true,
    });
    await auth.api.addMember({
      body: { userId: m.response.user.id, organizationId: orgId, role: 'member' },
    });
    await new Promise((r) => setTimeout(r, 200)); // 비동기 버스 핸들러 플러시

    expect(await currentEpoch(orgId)).toBeGreaterThan(before);
  });

  test('★서비스키로 /v1/service/entitlements/:org/epoch 조회 (제품 API 경로)', async () => {
    const { auth } = await import('../../auth');
    const { app } = await import('../../../app');
    const { headers } = await auth.api.signUpEmail({
      body: { email: `${uniq('se')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
      returnHeaders: true,
    });
    const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'se org', slug: uniq('se') },
      headers: new Headers({ cookie }),
    });
    const orgId = org!.id;
    // orgId로 스코프된 서비스 키
    const created = await auth.api.createApiKey({
      body: { name: 'svc', metadata: { orgId } },
      headers: new Headers({ cookie }),
    });
    const key = (created as { key: string }).key;

    const res = await app.request(`/v1/service/entitlements/${orgId}/epoch`, {
      headers: { 'x-api-key': key },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { epoch: number };
    expect(typeof body.epoch).toBe('number');

    // 다른 org 조회는 403 (키 스코프 밖)
    const other = await app.request(`/v1/service/entitlements/${uniq('other')}/epoch`, {
      headers: { 'x-api-key': key },
    });
    expect(other.status).toBe(403);
  });

  test('★스코프 없는(글로벌) 서비스키는 아무 org epoch도 못 읽음 → 403 (fail-closed)', async () => {
    const { auth } = await import('../../auth');
    const { app } = await import('../../../app');
    const { headers } = await auth.api.signUpEmail({
      body: { email: `${uniq('gk')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
      returnHeaders: true,
    });
    const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'gk org', slug: uniq('gk') },
      headers: new Headers({ cookie }),
    });
    // metadata.orgId 없는 키 → serviceOrgId=null (글로벌)
    const created = await auth.api.createApiKey({
      body: { name: 'global' },
      headers: new Headers({ cookie }),
    });
    const key = (created as { key: string }).key;
    const res = await app.request(`/v1/service/entitlements/${org!.id}/epoch`, {
      headers: { 'x-api-key': key },
    });
    expect(res.status).toBe(403); // 예전엔 200(크로스테넌트 홀)
  });

  test('★revocation loop: 토큰@N 발급 → 멤버변경 → isEntitlementStale(N, 현재)=true', async () => {
    const { auth } = await import('../../auth');
    const { currentEpoch, buildClaims } = await import('../service');
    const owner = await auth.api.signUpEmail({
      body: { email: `${uniq('rv')}@p0.test`, password: 'Str0ng!passw0rd', name: 'o' },
      returnHeaders: true,
    });
    const cookie = owner.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'rv org', slug: uniq('rv') },
      headers: new Headers({ cookie }),
    });
    const orgId = org!.id;
    await new Promise((r) => setTimeout(r, 150));

    // 토큰 발급 시점의 epoch
    const claims = await buildClaims({ userId: owner.response.user.id, orgId });

    // 멤버 추가 → epoch bump
    const m = await auth.api.signUpEmail({
      body: { email: `${uniq('rv')}@p0.test`, password: 'Str0ng!passw0rd', name: 'm' },
      returnHeaders: true,
    });
    await auth.api.addMember({
      body: { userId: m.response.user.id, organizationId: orgId, role: 'member' },
    });
    await new Promise((r) => setTimeout(r, 200));

    // 예전 토큰은 이제 stale로 판정돼야 한다 (제품 API가 거부/재발급)
    expect(isEntitlementStale(claims.epoch, await currentEpoch(orgId))).toBe(true);
  });

  test('★멤버 제거도 epoch를 bump한다 (권한 강등/축출 revocation)', async () => {
    const { auth } = await import('../../auth');
    const { currentEpoch } = await import('../service');
    const owner = await auth.api.signUpEmail({
      body: { email: `${uniq('rm')}@p0.test`, password: 'Str0ng!passw0rd', name: 'o' },
      returnHeaders: true,
    });
    const cookie = owner.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'rm org', slug: uniq('rm') },
      headers: new Headers({ cookie }),
    });
    const orgId = org!.id;
    const m = await auth.api.signUpEmail({
      body: { email: `${uniq('rm')}@p0.test`, password: 'Str0ng!passw0rd', name: 'm' },
      returnHeaders: true,
    });
    await auth.api.addMember({
      body: { userId: m.response.user.id, organizationId: orgId, role: 'member' },
    });
    await new Promise((r) => setTimeout(r, 200));
    const afterAdd = await currentEpoch(orgId);

    await auth.api.removeMember({
      body: { memberIdOrEmail: m.response.user.email, organizationId: orgId },
      headers: new Headers({ cookie }),
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(await currentEpoch(orgId)).toBeGreaterThan(afterAdd);
  });

  test('구독 취소 시 epoch 무효화(bump)된다', async () => {
    const { auth } = await import('../../auth');
    const { currentEpoch } = await import('../service');
    const { cancelOrgSubscription, getStatus } = await import('../../billing');
    const { billingStore } = await import('../../billing/adapters/store');
    const { headers } = await auth.api.signUpEmail({
      body: { email: `${uniq('cx')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
      returnHeaders: true,
    });
    const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const org = await auth.api.createOrganization({
      body: { name: 'cx org', slug: uniq('cx') },
      headers: new Headers({ cookie }),
    });
    const orgId = org!.id;
    await billingStore.upsert({
      orgId,
      stripeCustomerId: null, // 구독 없음 → cancel은 no-op이지만 invalidate는 emit
      stripeSubscriptionId: null,
      plan: 'free',
      status: 'none',
      currentPeriodEnd: null,
      watermark: null,
    });
    await new Promise((r) => setTimeout(r, 150));
    const before = await currentEpoch(orgId);
    await cancelOrgSubscription(orgId);
    await new Promise((r) => setTimeout(r, 150));
    void getStatus;
    expect(await currentEpoch(orgId)).toBeGreaterThan(before);
  });
});

test.skipIf(up)('⚠️ DB 미기동 — epoch 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
