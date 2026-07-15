// RED → billing/domain/price-table.ts 가 구현 대상.
import { describe, expect, test } from 'bun:test';
import { buildPriceTable } from '../domain/price-table';

describe('buildPriceTable', () => {
  test('설정된 price만 테이블에 들어간다', () => {
    const t = buildPriceTable({
      teamMonthly: 'price_tm',
      businessAnnual: 'price_ba',
    });
    expect(t['team:monthly']).toBe('price_tm');
    expect(t['business:annual']).toBe('price_ba');
    expect(t['team:annual']).toBeUndefined();
    expect(t['business:monthly']).toBeUndefined();
  });

  test('아무것도 없으면 빈 테이블 (placeholder 금지)', () => {
    expect(Object.keys(buildPriceTable({}))).toHaveLength(0);
  });
});
