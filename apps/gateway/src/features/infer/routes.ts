import { Hono } from 'hono';
import { z } from 'zod';
import { emitUsage } from '../emit';
import { isTokenStale } from '../epoch';
import { checkQuota, commitUsage } from '../quota';
import { verifyToken } from '../verify';

export const inferRoutes = new Hono();

const inferBody = z.object({ tokens: z.number().int().positive().max(1_000_000) });

// 데모 제품 엔드포인트 — 실제 제품 API(llm-gateway)의 인가 흐름을 그대로 압축:
//   1) JWT 로컬검증(JWKS) → 클레임              [accounts 런타임 호출 없음]
//   2) epoch stale 검사 → 권한변경 후 토큰 거부   [revocation 실제 소비]
//   3) 서버측 쿼터 강제 → 초과 시 429            [돈-경로 하드 강제]
//   4) 인퍼런스(목) 후 usage 발행                [미터링 루프 닫음]
inferRoutes.post('/v1/infer', async (c) => {
  const auth = c.req.header('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return c.json({ error: 'missing bearer token' }, 401);

  const v = await verifyToken(token);
  if (!v.ok) return c.json({ error: v.reason }, 401);
  const { org, epoch, aiTokensPerMonth, features } = v.claims;
  if (!org) return c.json({ error: 'no org in token' }, 403);

  // 2) revocation: 권한 변경(plan/role/멤버십)으로 epoch가 오르면 이 토큰은 stale.
  if (await isTokenStale(org, epoch)) {
    return c.json({ error: 'stale entitlements — refresh token' }, 401);
  }

  // 기능 게이팅: 실제로는 ai.* 엔타이틀먼트 플래그로 게이팅해야 한다(contracts에 enum
  // 필요). 데모 엔드포인트는 quota+epoch가 실질 게이트이므로 별도 feature 게이트 생략.
  void features;

  const parsed = inferBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad body' }, 400);
  const { tokens } = parsed.data;

  // 3) 서버측 쿼터 — 라이브 카운터로 초과과금 하드 차단.
  const q = checkQuota(org, tokens, aiTokensPerMonth);
  if (!q.allow) {
    return c.json({ error: 'quota exceeded', limit: q.limit, used: q.used }, 429);
  }

  // 4) 미터링 먼저 — 발행 실패 시 서빙하지 않는다(fail-closed billing: 미청구 서빙 방지, H3).
  //    ⚠️ 이건 정확성>가용성 선택 — accounts 장애 시 infer 불가. 트래픽 생기면 durable
  //    outbox로 발행하고 즉시 서빙하는 편이 나을 수 있다(가용성 우선).
  try {
    await emitUsage({ orgId: org, metric: 'ai_tokens', quantity: tokens });
  } catch (e) {
    console.error('[gateway] usage emit failed — refusing to serve unbilled:', e);
    return c.json({ error: 'metering unavailable' }, 502);
  }
  // 발행 성공 후에만 소비 확정 + 서빙.
  commitUsage(org, tokens);

  return c.json({
    ok: true,
    remaining: q.remaining,
    emitted: true,
    output: `inferred (${tokens} tokens)`,
  });
});
