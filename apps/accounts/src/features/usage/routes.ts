import { Hono } from 'hono';
import { usageEvent } from '@p0/contracts';
import { requireServiceKey, type ServiceEnv } from '../../lib/guard';
import { keyAllowsOrg } from './domain/scope';
import { recordUsage } from './service';

export const usageRoutes = new Hono<ServiceEnv>();

// 제품 서비스(intel/llm-gateway)가 x-api-key로 호출.
usageRoutes.post('/usage', requireServiceKey, async (c) => {
  const parsed = usageEvent.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ kind: 'validation', message: parsed.error.message }, 400);
  }
  // C1: org-스코프 키는 자기 org의 사용량만 기록할 수 있다.
  if (!keyAllowsOrg(c.get('serviceOrgId'), parsed.data.orgId)) {
    return c.json(
      { kind: 'forbidden', message: 'service key not scoped to this org' },
      403,
    );
  }
  await recordUsage(parsed.data);
  return c.json({ ok: true });
});
