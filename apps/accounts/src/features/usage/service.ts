// 유스케이스 — ports(store) + 이벤트 발행.
import { newId } from '@p0/shared';
import type { UsageEvent } from '@p0/contracts';
import { bus } from '../../lib/events';
import { usageStore } from './adapters/store';

/** 제품이 쏜 미터링 이벤트 적재 — idempotencyKey 중복은 조용히 무시 */
export async function recordUsage(event: UsageEvent): Promise<void> {
  await usageStore.insert({
    id: newId('use'),
    orgId: event.orgId,
    metric: event.metric,
    quantity: event.quantity,
    at: new Date(event.at),
    idempotencyKey: event.idempotencyKey,
  });

  bus.emit('usage.recorded', event);
  // TODO: Stripe Billing Meters로 릴레이 (배치 워커 or 즉시) → relayedAt 마킹
}
