// usage 이벤트 입력 경계 — 미터 오염/오버플로/backdating 차단 (라운드-3 C-1).
import { describe, expect, test } from 'bun:test';
import { MAX_USAGE_QUANTITY, usageEvent } from '@p0/contracts';

function ev(over: Record<string, unknown> = {}) {
  return {
    orgId: 'org_A',
    metric: 'ai_tokens',
    quantity: 100,
    at: new Date().toISOString(),
    idempotencyKey: 'k'.repeat(10),
    ...over,
  };
}

describe('usageEvent quantity 경계', () => {
  test('정상 수량 통과', () => {
    expect(usageEvent.safeParse(ev({ quantity: 1 })).success).toBe(true);
    expect(usageEvent.safeParse(ev({ quantity: MAX_USAGE_QUANTITY })).success).toBe(true);
  });
  test('★상한 초과(1e308) 거부 — 미터 오염/오버플로 차단', () => {
    expect(usageEvent.safeParse(ev({ quantity: 1e308 })).success).toBe(false);
    expect(usageEvent.safeParse(ev({ quantity: MAX_USAGE_QUANTITY + 1 })).success).toBe(false);
  });
  test('0/음수/Infinity/NaN 거부', () => {
    for (const q of [0, -1, Infinity, -Infinity, NaN]) {
      expect(usageEvent.safeParse(ev({ quantity: q })).success).toBe(false);
    }
  });
});

describe('usageEvent at(타임스탬프) 윈도우', () => {
  test('현재 시각 통과', () => {
    expect(usageEvent.safeParse(ev()).success).toBe(true);
  });
  test('★먼 미래(+1일) 거부 — future-dating으로 청구 윈도우 회피 차단', () => {
    const future = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    expect(usageEvent.safeParse(ev({ at: future })).success).toBe(false);
  });
  test('★먼 과거(1년 전) 거부 — backdating 차단', () => {
    const past = new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString();
    expect(usageEvent.safeParse(ev({ at: past })).success).toBe(false);
  });
  test('최근(1시간 전)은 통과', () => {
    const recent = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(usageEvent.safeParse(ev({ at: recent })).success).toBe(true);
  });
});
