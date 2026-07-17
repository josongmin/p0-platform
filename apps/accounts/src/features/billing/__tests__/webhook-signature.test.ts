// webhook 서명/에러 경로 (H2) — 위조·미서명 요청이 스택 노출 없이 거부되는가.
import { describe, expect, test } from 'bun:test';
import { app } from '../../../app';

describe('webhook 서명 검증', () => {
  test('stripe-signature 헤더 없으면 400', async () => {
    const res = await app.request('/v1/billing/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { kind: string; message: string };
    expect(body.kind).toBe('unauthorized');
    // 내부 스택/시크릿 미노출
    expect(body.message).not.toContain('STRIPE');
    expect(body.message).not.toContain('at ');
  });

  test('서명이 잘못되면 400 (스택/시크릿 노출 없이)', async () => {
    const res = await app.request('/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1,v1=deadbeef',
      },
      body: '{"id":"evt_forged","type":"customer.subscription.deleted"}',
    });
    // Stripe 시크릿 미설정이면 검증 자체가 throw → 400 (500 아님)
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).not.toContain('whsec');
    expect(body.message.toLowerCase()).not.toContain('stack');
  });
});
