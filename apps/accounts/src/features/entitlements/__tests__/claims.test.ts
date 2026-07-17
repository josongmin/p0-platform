// buildClaims — JWT에 실리는 엔타이틀먼트. 제품 API가 이걸로 인가하므로 핵심.
import { describe, expect, test } from 'bun:test';

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

describe('buildClaims', () => {
  test('org 없는 세션 → free/member 기본값 (DB 불필요)', async () => {
    const { buildClaims } = await import('../service');
    const claims = await buildClaims({ userId: 'u1', orgId: null });
    expect(claims.org).toBeNull();
    expect(claims.plan).toBe('free');
    expect(claims.role).toBe('member');
    expect(claims.maxSeats).toBe(3);
    expect(Array.isArray(claims.features)).toBe(true);
    expect(claims.features).toContain('viz.basic');
    // 무료/멤버는 쓰기 기능 없음
    expect(claims.aiTokensPerMonth).toBeGreaterThan(0);
  });
});

describe.skipIf(!up)('JWT 토큰에 실제로 클레임이 박히는가 (integration)', () => {
  test('/api/auth/token 으로 발급된 JWT payload에 plan/role/한도 포함', async () => {
    const { auth } = await import('../../auth');
    const { headers } = await auth.api.signUpEmail({
      body: {
        email: `claims_${crypto.randomUUID().slice(0, 8)}@p0.test`,
        password: 'Str0ng!passw0rd',
        name: 't',
      },
      returnHeaders: true,
    });
    const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

    const { app } = await import('../../../app');
    const res = await app.request('/api/auth/token', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    // JWT payload 디코드 (서명 검증은 JWKS 몫 — 여기선 클레임 존재만 확인)
    const payloadB64 = token.split('.')[1] ?? '';
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    expect(payload.plan).toBe('free');
    expect(payload.role).toBe('member');
    expect(payload).toHaveProperty('maxSeats');
    expect(payload).toHaveProperty('features');
    expect(Array.isArray(payload.features)).toBe(true);
  });
});

test.skipIf(up)('⚠️ DB 미기동 — JWT 클레임 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
