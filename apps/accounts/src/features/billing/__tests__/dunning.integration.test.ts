// dunning — invoice.payment_failed 처리(dedup → 알림메일 → 감사기록). DB 없으면 skip.
import { describe, expect, test } from 'bun:test';
import { handleWebhookEvent } from '../service';
import type { InvoiceChange } from '../domain/webhook';
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
const uniq = (p: string) => `${p}_${crypto.randomUUID().slice(0, 12)}`;

async function makeOrgWithCustomer(customerId: string): Promise<string> {
  const { headers } = await auth.api.signUpEmail({
    body: { email: `${uniq('dn')}@p0.test`, password: 'Str0ng!passw0rd', name: 't' },
    returnHeaders: true,
  });
  const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const org = await auth.api.createOrganization({
    body: { name: 'dunning org', slug: uniq('dn') },
    headers: new Headers({ cookie }),
  });
  const { billingStore } = await import('../adapters/store');
  await billingStore.upsert({
    orgId: org!.id,
    stripeCustomerId: customerId,
    stripeSubscriptionId: uniq('sub'),
    plan: 'team',
    status: 'active',
    currentPeriodEnd: null,
    watermark: 1,
  });
  return org!.id;
}

function invoiceFailed(over: Partial<InvoiceChange>): InvoiceChange {
  return {
    invoiceKind: 'payment_failed',
    eventId: uniq('evt'),
    stripeCustomerId: uniq('cus'),
    customerEmail: 'billing@p0.test',
    amountDue: 2900,
    currency: 'usd',
    attemptCount: 2,
    ...over,
  };
}

async function countPaymentFailedAudit(orgId: string): Promise<number> {
  const { listAudit } = await import('../../audit');
  const entries = await listAudit(orgId);
  return entries.filter((e) => e.action === 'billing.payment_failed').length;
}

describe.skipIf(!up)('dunning (integration)', () => {
  test('invoice.payment_failed → billing.payment_failed 감사기록', async () => {
    const customerId = uniq('cus');
    const orgId = await makeOrgWithCustomer(customerId);

    await handleWebhookEvent(invoiceFailed({ stripeCustomerId: customerId }));
    await new Promise((r) => setTimeout(r, 200)); // 비동기 버스 → audit 플러시

    expect(await countPaymentFailedAudit(orgId)).toBeGreaterThanOrEqual(1);
  });

  test('★멱등: 같은 event.id 재처리는 no-op (dunning 메일·감사 중복 없음)', async () => {
    const customerId = uniq('cus');
    const orgId = await makeOrgWithCustomer(customerId);
    const eventId = uniq('evt');

    await handleWebhookEvent(invoiceFailed({ eventId, stripeCustomerId: customerId }));
    await new Promise((r) => setTimeout(r, 200));
    const after1 = await countPaymentFailedAudit(orgId);
    expect(after1).toBe(1);

    // 같은 event.id 재배송 → markEventProcessed false → 아무것도 안 함
    await handleWebhookEvent(invoiceFailed({ eventId, stripeCustomerId: customerId }));
    await new Promise((r) => setTimeout(r, 200));
    expect(await countPaymentFailedAudit(orgId)).toBe(after1); // 여전히 1
  });

  test('customer_email 없어도 크래시 없이 감사기록(메일만 스킵)', async () => {
    const customerId = uniq('cus');
    const orgId = await makeOrgWithCustomer(customerId);
    await handleWebhookEvent(
      invoiceFailed({ stripeCustomerId: customerId, customerEmail: null }),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(await countPaymentFailedAudit(orgId)).toBeGreaterThanOrEqual(1);
  });
});

test.skipIf(up)('⚠️ DB 미기동 — dunning 통합테스트 skip됨', () => {
  expect(up).toBe(false);
});
