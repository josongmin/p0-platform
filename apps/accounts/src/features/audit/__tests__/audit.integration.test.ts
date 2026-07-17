// RED → audit feature 전체가 구현 대상. DB 필요 (없으면 skip).
import { beforeAll, describe, expect, test } from 'bun:test';
import { app } from '../../../app';
import { auth } from '../../auth';
import { bus } from '../../../lib/events';

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

const uniq = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

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

describe.skipIf(!up)('audit log (integration)', () => {
  let ownerCookie = '';
  let orgId = '';

  beforeAll(async () => {
    const owner = await signUp(`${uniq('audit-owner')}@p0.test`);
    ownerCookie = owner.cookie;
    const org = await auth.api.createOrganization({
      body: { name: 'audit org', slug: uniq('audit') },
      headers: new Headers({ cookie: ownerCookie }),
    });
    orgId = org!.id;
  });

  test('버스 이벤트가 audit에 적재되고 owner가 조회한다', async () => {
    bus.emit('billing.subscription.updated', {
      orgId,
      plan: 'team',
      status: 'active',
    });
    await new Promise((r) => setTimeout(r, 150)); // 비동기 핸들러 플러시

    const res = await app.request(`/v1/audit/${orgId}`, {
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { action: string }[] };
    expect(body.entries.some((e) => e.action === 'billing.subscription.updated')).toBe(true);
  });

  test('member 역할은 audit 조회 403', async () => {
    const m = await signUp(`${uniq('audit-member')}@p0.test`);
    await auth.api.addMember({
      body: { userId: m.userId, organizationId: orgId, role: 'member' },
    });
    const res = await app.request(`/v1/audit/${orgId}`, {
      headers: { cookie: m.cookie },
    });
    expect(res.status).toBe(403);
  });

  test('limit 방어: 비숫자/음수/과대값에도 500이 아니라 200', async () => {
    for (const bad of ['abc', '-5', '999999', '0']) {
      const res = await app.request(`/v1/audit/${orgId}?limit=${bad}`, {
        headers: { cookie: ownerCookie },
      });
      expect(res.status).toBe(200);
    }
  });
});
