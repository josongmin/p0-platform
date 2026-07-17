import { Hono } from 'hono';
import {
  requireMember,
  requireServiceKey,
  type GuardEnv,
  type ServiceEnv,
} from '../../lib/guard';
import { buildClaims, currentEpoch } from './service';

export const entitlementsRoutes = new Hono<GuardEnv>();

entitlementsRoutes.get('/entitlements/:orgId', requireMember(), async (c) =>
  c.json(await buildClaims({ userId: c.get('userId'), orgId: c.get('orgId') })),
);

// UI(세션)용 epoch 조회.
entitlementsRoutes.get('/entitlements/:orgId/epoch', requireMember(), async (c) =>
  c.json({ epoch: await currentEpoch(c.get('orgId')) }),
);

// ★제품 API용 — JWT/서비스키로 인증하는 실제 소비자가 stale 판정에 쓴다.
// 세션이 없으므로 x-api-key(서비스키)로 인증하고, 키 org 스코프 밖 조회는 거부.
export const entitlementsServiceRoutes = new Hono<ServiceEnv>();
entitlementsServiceRoutes.get(
  '/service/entitlements/:orgId/epoch',
  requireServiceKey,
  async (c) => {
    const keyOrg = c.get('serviceOrgId');
    const orgId = c.req.param('orgId');
    // fail-closed: 스코프 없는(null=글로벌) 키도 거부 — usage의 keyAllowsOrg와 동일 규약.
    // (예전 `keyOrg !== null && ...`는 null 키가 아무 org epoch를 읽는 크로스테넌트 홀)
    if (keyOrg === null || keyOrg !== orgId) {
      return c.json({ kind: 'forbidden', message: 'key not scoped to this org' }, 403);
    }
    return c.json({ epoch: await currentEpoch(orgId) });
  },
);
