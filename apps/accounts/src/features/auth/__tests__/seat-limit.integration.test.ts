// 시트 한도 강제 — free(3석) org에 한도 초과 멤버추가는 거부돼야 한다 (DB 없으면 skip).
import { beforeAll, describe, expect, test } from 'bun:test';
import '../../../app'; // composition root 트리거 — setSeatLimitResolver 배선 (필수)
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
const uniq = (p: string) => `${p}_${crypto.randomUUID().slice(0, 8)}`;

async function newUser() {
  const { headers, response } = await auth.api.signUpEmail({
    body: { email: `${uniq('seat')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
    returnHeaders: true,
  });
  const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { cookie, userId: response.user.id };
}

describe.skipIf(!up)('seat limit enforcement (integration)', () => {
  let orgId = '';

  beforeAll(async () => {
    const owner = await newUser(); // 멤버 1/3
    const org = await auth.api.createOrganization({
      body: { name: 'seat org', slug: uniq('seat') },
      headers: new Headers({ cookie: owner.cookie }),
    });
    orgId = org!.id;
  });

  test('free 플랜(3석): 2명 추가는 성공(총 3), 4번째는 거부', async () => {
    const m2 = await newUser();
    const m3 = await newUser();
    // 2, 3번째 멤버 → 총 3석까지 OK
    await auth.api.addMember({
      body: { userId: m2.userId, organizationId: orgId, role: 'member' },
    });
    await auth.api.addMember({
      body: { userId: m3.userId, organizationId: orgId, role: 'member' },
    });

    // 4번째 → 한도 초과 → 거부(throw)
    const m4 = await newUser();
    await expect(
      auth.api.addMember({
        body: { userId: m4.userId, organizationId: orgId, role: 'member' },
      }),
    ).rejects.toThrow();
  });
});

test.skipIf(up)('⚠️ DB 미기동 — seat-limit 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
