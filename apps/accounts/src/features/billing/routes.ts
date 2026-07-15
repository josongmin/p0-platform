import { Hono } from 'hono';
import { checkoutRequest } from '@p0/contracts';
import { requirePermission, type GuardEnv } from '../../lib/guard';
import { parseWebhookEvent } from './adapters/stripe-gateway';
import {
  createCheckout,
  createPortal,
  getStatus,
  handleWebhookEvent,
} from './service';

export const billingRoutes = new Hono<GuardEnv>();

billingRoutes.get(
  '/billing/:orgId',
  requirePermission('billing', 'read'),
  async (c) => c.json(await getStatus(c.get('orgId'))),
);

billingRoutes.post(
  '/billing/:orgId/checkout',
  requirePermission('billing', 'manage'),
  async (c) => {
    const parsed = checkoutRequest.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ kind: 'validation', message: parsed.error.message }, 400);
    }
    const result = await createCheckout(c.get('orgId'), parsed.data);
    if (!result.ok) {
      return c.json({ kind: 'validation', message: 'plan not available' }, 400);
    }
    return c.json({ url: result.url });
  },
);

billingRoutes.post(
  '/billing/:orgId/portal',
  requirePermission('billing', 'manage'),
  async (c) => {
    const portal = await createPortal(c.get('orgId'));
    if (!portal) {
      return c.json({ kind: 'validation', message: 'no billing account yet' }, 400);
    }
    return c.json(portal);
  },
);

// Stripe가 호출 — 세션 대신 서명 검증
billingRoutes.post('/billing/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ kind: 'unauthorized', message: 'bad signature' }, 400);
  }
  let change;
  try {
    change = await parseWebhookEvent(await c.req.text(), signature);
  } catch (e) {
    // 서명 검증 실패 = 위조/구성오류 → 400 (스택 노출 없이)
    console.error('[billing] webhook verify failed:', e);
    return c.json({ kind: 'unauthorized', message: 'signature verification failed' }, 400);
  }
  await handleWebhookEvent(change);
  return c.json({ received: true });
});
