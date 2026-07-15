// RED → domain/subscription.ts 가 구현 대상.
// Stripe 이벤트 → 구독상태/플랜 매핑은 순수 도메인.
import { describe, expect, test } from 'bun:test';
import { mapStripeStatus, resolvePlan } from '../domain/subscription';

describe('mapStripeStatus', () => {
  test('deleted 이벤트는 상태 불문 canceled', () => {
    expect(mapStripeStatus('active', 'customer.subscription.deleted')).toBe('canceled');
  });
  test('stripe status 매핑', () => {
    expect(mapStripeStatus('trialing', 'customer.subscription.updated')).toBe('trialing');
    expect(mapStripeStatus('active', 'customer.subscription.updated')).toBe('active');
    expect(mapStripeStatus('past_due', 'customer.subscription.updated')).toBe('past_due');
    expect(mapStripeStatus('unpaid', 'customer.subscription.updated')).toBe('past_due');
    expect(mapStripeStatus('canceled', 'customer.subscription.updated')).toBe('canceled');
    expect(mapStripeStatus('incomplete', 'customer.subscription.updated')).toBe('none');
  });
});

describe('resolvePlan', () => {
  const table = { 'team:monthly': 'price_1', 'business:annual': 'price_2' };
  test('price id → plan', () => {
    expect(resolvePlan('price_1', table)).toBe('team');
    expect(resolvePlan('price_2', table)).toBe('business');
  });
  test('모르는 price는 free로 fail-safe', () => {
    expect(resolvePlan('price_x', table)).toBe('free');
    expect(resolvePlan(undefined, table)).toBe('free');
  });
});
