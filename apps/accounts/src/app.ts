import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { auditRoutes, registerAuditSubscriptions } from './features/audit';
import {
  authRoutes,
  deleteOrgById,
  memberOrgIds,
  setClaimsBuilder,
  setOrgDeletingHandler,
  setSeatLimitResolver,
  setUserDeletingHandler,
  soleOwnedOrgIds,
} from './features/auth';
import { billingRoutes, cancelOrgSubscription } from './features/billing';
import { bus } from './lib/events';
import {
  buildClaims,
  entitlementsRoutes,
  entitlementsServiceRoutes,
  registerEpochSubscriptions,
  seatLimitForOrg,
} from './features/entitlements';
import { usageRoutes } from './features/usage';
import { env } from './lib/env';
import { buildOpenApiDoc } from './openapi';

// ── composition root — feature 간 배선은 여기서만 (순환 import 차단용 늦은 바인딩) ──
// auth의 JWT definePayload가 entitlements 클레임을 싣는다.
setClaimsBuilder(buildClaims);
// 시트 한도 강제: org plan → 최대 멤버수.
setSeatLimitResolver(seatLimitForOrg);
// org 삭제 직전 Stripe 구독 취소.
setOrgDeletingHandler(cancelOrgSubscription);
// 사용자 삭제 직전: 단독소유 org의 구독 취소 + org 삭제 (고아 org·유령 구독 방지).
// + 소속 모든 org의 epoch 무효화 — 멤버가 FK cascade로 제거되면 afterRemoveMember
//   훅이 안 뛰므로, 여기서 명시적으로 무효화해 stale 토큰을 revoke한다.
setUserDeletingHandler(async (userId) => {
  for (const orgId of await memberOrgIds(userId)) {
    bus.emit('entitlements.invalidate', { orgId });
  }
  for (const orgId of await soleOwnedOrgIds(userId)) {
    await cancelOrgSubscription(orgId);
    await deleteOrgById(orgId);
  }
});
// 도메인 이벤트 → 감사 로그
registerAuditSubscriptions();
// 구독/멤버십 변경 → 엔타이틀먼트 epoch bump (JWT stale화)
registerEpochSubscriptions();

export const app = new Hono();

// 요청 바디 상한 — c.req.text()/json()이 전체를 버퍼링하므로(특히 무인증 webhook)
// 대용량 바디 메모리 DoS를 막는다. Stripe 이벤트·우리 JSON은 모두 작다.
app.use(
  '*',
  bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => c.json({ kind: 'validation', message: 'payload too large' }, 413),
  }),
);

// CORS — 브라우저 FE(크로스오리진)가 쿠키 세션으로 호출하려면 필요.
// 서비스키(x-api-key) 경로는 서버간이라 무관하지만 통일 적용.
const trustedOrigins =
  env.TRUSTED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
if (trustedOrigins.length > 0) {
  app.use(
    '*',
    cors({
      origin: trustedOrigins,
      credentials: true,
      allowHeaders: ['content-type', 'x-api-key', 'authorization'],
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );
}

app.onError((err, c) => {
  // 상세는 서버 로그로만 — 클라이언트에는 내부 메시지/스택을 절대 노출하지 않는다.
  console.error('[accounts]', err);
  return c.json({ kind: 'http', message: 'internal error' }, 500);
});

app.get('/health', (c) => c.json({ ok: true, service: 'accounts' }));
app.get('/openapi.json', (c) => c.json(buildOpenApiDoc()));

app.route('/', authRoutes); // better-auth 규약상 /api/auth 고정
app.route('/v1', billingRoutes);
app.route('/v1', entitlementsRoutes);
app.route('/v1', entitlementsServiceRoutes); // 제품 API용 서비스키 epoch 조회
app.route('/v1', usageRoutes);
app.route('/v1', auditRoutes);
