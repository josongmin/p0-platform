// 미터 릴레이 결정 — 순수.
import { describe, expect, test } from 'bun:test';
import {
  decideRelay,
  isPastNoCustomerGrace,
  isTooOldToMeter,
  meterEventName,
} from '../domain/relay';

describe('isTooOldToMeter (Stripe 35일 윈도우)', () => {
  const now = new Date('2026-07-16T00:00:00Z');
  test('34일 이내는 릴레이 가능', () => {
    expect(isTooOldToMeter(new Date('2026-07-15T00:00:00Z'), now)).toBe(false);
    expect(isTooOldToMeter(new Date('2026-06-20T00:00:00Z'), now)).toBe(false);
  });
  test('35일 초과는 만료 (Stripe 거부 → 드롭)', () => {
    expect(isTooOldToMeter(new Date('2026-06-01T00:00:00Z'), now)).toBe(true);
  });
});

describe('meterEventName', () => {
  const mapping = { ai_tokens: 'mtr_tokens', scans: 'mtr_scans' };
  test('설정된 metric → event_name', () => {
    expect(meterEventName('ai_tokens', mapping)).toBe('mtr_tokens');
  });
  test('미설정 metric → null', () => {
    expect(meterEventName('storage_mb', mapping)).toBeNull();
  });
});

describe('isPastNoCustomerGrace (3일 유예)', () => {
  const now = new Date('2026-07-16T00:00:00Z');
  test('유예 내(2일 전)는 아직 defer 대상', () => {
    expect(isPastNoCustomerGrace(new Date('2026-07-14T00:00:00Z'), now)).toBe(false);
  });
  test('유예 초과(4일 전)는 free 확정', () => {
    expect(isPastNoCustomerGrace(new Date('2026-07-12T00:00:00Z'), now)).toBe(true);
  });
});

describe('decideRelay', () => {
  test('★고객 없음 + 유예 내 → defer-no-customer (영구 write-off 방지)', () => {
    expect(decideRelay(null, 'mtr_x', false).kind).toBe('defer-no-customer');
    expect(decideRelay(null, null, false).kind).toBe('defer-no-customer');
  });
  test('고객 없음 + 유예 초과 → mark-nonbillable (free 확정, 프루닝 대상화)', () => {
    expect(decideRelay(null, 'mtr_x', true).kind).toBe('mark-nonbillable');
    expect(decideRelay(null, null, true).kind).toBe('mark-nonbillable');
  });
  test('고객 있고 meter 없음 → defer-no-meter (유실 방지 보류)', () => {
    expect(decideRelay('cus_1', null, false).kind).toBe('defer-no-meter');
    expect(decideRelay('cus_1', null, true).kind).toBe('defer-no-meter');
  });
  test('고객+meter → relay (customerId·eventName 실림)', () => {
    const a = decideRelay('cus_1', 'mtr_x', false);
    expect(a.kind).toBe('relay');
    if (a.kind === 'relay') {
      expect(a.customerId).toBe('cus_1');
      expect(a.eventName).toBe('mtr_x');
    }
  });
});
