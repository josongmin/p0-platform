import { Hono } from 'hono';
import { auditRoutes, registerAuditSubscriptions } from './features/audit';
import { authRoutes, setClaimsBuilder } from './features/auth';
import { billingRoutes } from './features/billing';
import { buildClaims, entitlementsRoutes } from './features/entitlements';
import { usageRoutes } from './features/usage';
import { buildOpenApiDoc } from './openapi';

// ── composition root — feature 간 배선은 여기서만 ──────────────
// auth의 JWT definePayload가 entitlements 클레임을 싣는다 (순환 import 차단용 늦은 바인딩).
setClaimsBuilder(buildClaims);
// 도메인 이벤트 → 감사 로그
registerAuditSubscriptions();

export const app = new Hono();

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
app.route('/v1', usageRoutes);
app.route('/v1', auditRoutes);
