import { describe, expect, test } from 'bun:test';
import { decideQuota } from './quota';

describe('decideQuota (서버측 쿼터)', () => {
  test('한도 내 요청 허용 + remaining', () => {
    const d = decideQuota(100, 50, 1000);
    expect(d.allow).toBe(true);
    if (d.allow) expect(d.remaining).toBe(850);
  });
  test('★한도 정확히 도달까지 허용', () => {
    const d = decideQuota(950, 50, 1000);
    expect(d.allow).toBe(true);
    if (d.allow) expect(d.remaining).toBe(0);
  });
  test('★한도 초과 1 → 거부(429 근거)', () => {
    const d = decideQuota(950, 51, 1000);
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe('quota-exceeded');
      expect(d.limit).toBe(1000);
      expect(d.used).toBe(950);
    }
  });
  test('0 요청은 항상 허용(잔량 조회)', () => {
    expect(decideQuota(1000, 0, 1000).allow).toBe(true);
  });
  // mutation survivor(quota.ts:17 <=→<)가 찾은 갭 — 이미 초과 상태의 0-요청 프로브
  test('★이미 한도 초과 상태에서도 0 요청은 허용 + remaining 0 클램프', () => {
    const d = decideQuota(1200, 0, 1000);
    expect(d.allow).toBe(true);
    if (d.allow) expect(d.remaining).toBe(0);
  });
});
