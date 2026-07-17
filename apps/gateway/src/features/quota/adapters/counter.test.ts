import { afterEach, describe, expect, test } from 'bun:test';
import { _resetCounters, addUsed, getUsed } from './counter';

afterEach(() => _resetCounters());

describe('usage counter (월별)', () => {
  test('누적 + 조회', () => {
    addUsed('o', 100);
    addUsed('o', 50);
    expect(getUsed('o')).toBe(150);
  });
  test('org별 격리', () => {
    addUsed('a', 10);
    addUsed('b', 20);
    expect(getUsed('a')).toBe(10);
    expect(getUsed('b')).toBe(20);
  });
  test('★월 바뀌면 리셋', () => {
    const jan = () => Date.parse('2026-01-15T00:00:00Z');
    const feb = () => Date.parse('2026-02-15T00:00:00Z');
    addUsed('o', 100, jan);
    expect(getUsed('o', jan)).toBe(100);
    expect(getUsed('o', feb)).toBe(0); // 2월엔 0
  });
});
