// C1 회귀(통합) — metadata.orgId로 묶인 서비스 키가 다른 org 사용량을 위조 못함.
import { beforeAll, describe, expect, test } from 'bun:test';
import { app } from '../../../app';
import { auth } from '../../auth';

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

function usageBody(orgId: string) {
  return {
    orgId,
    metric: 'ai_tokens' as const,
    quantity: 100,
    at: new Date().toISOString(),
    idempotencyKey: crypto.randomUUID(),
  };
}

describe.skipIf(!up)('service key org scoping (integration)', () => {
  let keyForOrgA = '';
  let orgA = '';
  let orgB = '';

  beforeAll(async () => {
    const { headers } = await auth.api.signUpEmail({
      body: { email: `${uniq('svc')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
      returnHeaders: true,
    });
    const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    // orgA는 실제 org (usage_events가 organization FK). orgB는 가짜여도 됨 —
    // 403이 guard에서 나서 DB에 도달하지 않으므로.
    const org = await auth.api.createOrganization({
      body: { name: 'svc org', slug: uniq('svc') },
      headers: new Headers({ cookie }),
    });
    orgA = org!.id;
    orgB = uniq('orgB');
    // 서비스 키를 metadata.orgId=orgA 로 묶는다 (enableMetadata 필요)
    const created = await auth.api.createApiKey({
      body: { name: 'svc-orgA', metadata: { orgId: orgA } },
      headers: new Headers({ cookie }),
    });
    keyForOrgA = (created as { key: string }).key;
  });

  test('키 없으면 401', async () => {
    const res = await app.request('/v1/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(usageBody(orgA)),
    });
    expect(res.status).toBe(401);
  });

  test('잘못된 키 401', async () => {
    const res = await app.request('/v1/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'totally-bogus' },
      body: JSON.stringify(usageBody(orgA)),
    });
    expect(res.status).toBe(401);
  });

  test('orgA 키로 orgA 사용량 기록 → 200', async () => {
    const res = await app.request('/v1/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': keyForOrgA },
      body: JSON.stringify(usageBody(orgA)),
    });
    expect(res.status).toBe(200);
  });

  test('★orgA 키로 orgB 사용량 위조 시도 → 403 (C1 차단, 진짜 크로스-org)', async () => {
    const res = await app.request('/v1/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': keyForOrgA },
      body: JSON.stringify(usageBody(orgB)),
    });
    expect(res.status).toBe(403);
  });
});

test.skipIf(up)('⚠️ DB 미기동 — service-key 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
