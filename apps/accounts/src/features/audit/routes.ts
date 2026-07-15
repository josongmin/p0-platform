import { Hono } from 'hono';
import { requirePermission, type GuardEnv } from '../../lib/guard';
import { listAudit } from './service';

export const auditRoutes = new Hono<GuardEnv>();

auditRoutes.get('/audit/:orgId', requirePermission('audit', 'read'), async (c) => {
  // limit 방어: 비숫자/음수/과대 입력을 1..200으로 클램프 (NaN → 50)
  const raw = Number(c.req.query('limit'));
  const limit = Number.isFinite(raw) ? Math.min(Math.max(1, raw), 200) : 50;
  return c.json({ entries: await listAudit(c.get('orgId'), limit) });
});
