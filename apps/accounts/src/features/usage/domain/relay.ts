// domain — 미터 릴레이 결정 로직. 순수 (Stripe 타입 없음).
import type { UsageMetric } from '@p0/contracts';

export type MeterMapping = Partial<Record<UsageMetric, string>>;

/** metric → Stripe meter event_name. 미설정이면 null (릴레이 불가). */
export function meterEventName(
  metric: UsageMetric,
  mapping: MeterMapping,
): string | null {
  return mapping[metric] ?? null;
}

// Stripe 미터 이벤트는 35일 이내만 허용. 그 이전은 거부되므로 무한 재시도 방지 위해
// 안전하게 34일로 컷 (경계 여유).
const MAX_METER_AGE_MS = 34 * 24 * 60 * 60_000;

/** Stripe 미터 윈도우(35일)를 넘겨 더 이상 청구 불가한 이벤트인가. */
export function isTooOldToMeter(at: Date, now: Date): boolean {
  return now.getTime() - at.getTime() > MAX_METER_AGE_MS;
}

// 고객(Stripe customer)이 아직 안 붙은 usage에 대한 유예 — 이 안이면 defer(재시도)해서
// 신규 결제고객의 초기 usage가 결제행 생기기 전에 영구 write-off되는 걸 막는다.
// 유예 지나도 고객이 없으면 genuinely-free로 보고 마킹(프루닝).
const NO_CUSTOMER_GRACE_MS = 3 * 24 * 60 * 60_000;

/** 고객 없이 유예를 넘긴(=genuinely free로 간주) 이벤트인가. */
export function isPastNoCustomerGrace(at: Date, now: Date): boolean {
  return now.getTime() - at.getTime() > NO_CUSTOMER_GRACE_MS;
}

type RelayAction =
  | { kind: 'relay'; eventName: string; customerId: string } // Stripe로 전송
  | { kind: 'mark-nonbillable' } // free 확정(유예 후 고객 없음) → 마킹해 프루닝 대상화
  | { kind: 'defer-no-customer' } // 고객 미부착(유예 내) → 보류, 웹훅이 고객 붙이면 릴레이
  | { kind: 'defer-no-meter' }; // meter 미설정(설정 버그) → 미릴레이 유지 + 로깅

/**
 * 한 usage 이벤트의 처리 방식 결정.
 *  - 고객 없음 + 유예 내: 보류(defer) — 결제행이 곧 붙을 수 있음(유실 방지).
 *  - 고객 없음 + 유예 초과: free 확정 → 완료 마킹(무한증가 방지).
 *  - 고객 있고 meter 있음: 릴레이.
 *  - 고객 있고 meter 없음: 설정 버그 → 보류(재시도로 살림), 유실 안 함.
 */
export function decideRelay(
  customerId: string | null,
  eventName: string | null,
  pastNoCustomerGrace: boolean,
): RelayAction {
  if (customerId === null) {
    return pastNoCustomerGrace ? { kind: 'mark-nonbillable' } : { kind: 'defer-no-customer' };
  }
  if (eventName === null) return { kind: 'defer-no-meter' };
  return { kind: 'relay', eventName, customerId };
}
