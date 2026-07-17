// 시트 한도 매핑 — plan → maxSeats. 순수.
import { describe, expect, test } from 'bun:test';
import { maxSeatsForPlan } from '../domain/policy';

describe('maxSeatsForPlan', () => {
  test('플랜별 시트', () => {
    expect(maxSeatsForPlan('free')).toBe(3);
    expect(maxSeatsForPlan('team')).toBe(25);
    expect(maxSeatsForPlan('business')).toBe(100);
    expect(maxSeatsForPlan('enterprise')).toBe(Number.MAX_SAFE_INTEGER);
  });
  test('오염/미지 plan은 free 하한으로 폴백 (관대한 한도로 안 새게)', () => {
    expect(maxSeatsForPlan('startup_LEAKED')).toBe(3);
    expect(maxSeatsForPlan('')).toBe(3);
  });
});
