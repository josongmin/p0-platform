import { Hono } from 'hono';
import { requireMember, type GuardEnv } from '../../lib/guard';
import { buildClaims } from './service';

export const entitlementsRoutes = new Hono<GuardEnv>();

entitlementsRoutes.get('/entitlements/:orgId', requireMember(), async (c) =>
  c.json(await buildClaims({ userId: c.get('userId'), orgId: c.get('orgId') })),
);
