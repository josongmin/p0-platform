// 리텐션 컷오프 계산 — 순수.
import { describe, expect, test } from 'bun:test';
import { cutoffDate, RETENTION_DAYS } from '../retention';

describe('cutoffDate', () => {
  test('now에서 days만큼 과거', () => {
    const now = new Date('2026-07-16T00:00:00Z');
    const c = cutoffDate(now, 90);
    expect(c.toISOString()).toBe('2026-04-17T00:00:00.000Z');
  });
  test('리텐션 정책값 정합 (audit>usage>stripeEvents)', () => {
    expect(RETENTION_DAYS.audit).toBeGreaterThan(RETENTION_DAYS.usage);
    expect(RETENTION_DAYS.usage).toBeGreaterThan(RETENTION_DAYS.stripeEvents);
    // stripe 재시도 윈도우(~3일)보다 충분히 길어야 멱등 보장 유지
    expect(RETENTION_DAYS.stripeEvents).toBeGreaterThanOrEqual(30);
  });
});
