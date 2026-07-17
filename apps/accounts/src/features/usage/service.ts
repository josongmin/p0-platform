// 유스케이스 — ports(store/meter) + 이벤트 발행.
import { newId } from '@p0/shared';
import type { UsageEvent, UsageMetric } from '@p0/contracts';
import { getCustomerId, recordMeterEvent } from '../billing'; // ✅ 크로스 feature — 공개 API
import { bus } from '../../lib/events';
import { env } from '../../lib/env';
import { usageStore } from './adapters/store';
import {
  decideRelay,
  isPastNoCustomerGrace,
  isTooOldToMeter,
  meterEventName,
  type MeterMapping,
} from './domain/relay';

// Stripe identifier 멱등 윈도우(최소 24h)보다 안전하게 짧은 재전송 한계. 이 시각보다
// 오래 전에 시도됐는데 아직 미릴레이면 = 마킹 유실 의심 → 격리(재전송 안 함, 대사 필요).
const SAFE_RESEND_MS = 20 * 60 * 60_000;

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
}

/** 리텐션 프루닝 — 릴레이 완료 & cutoff 이전 미터링 이벤트 삭제. */
export function pruneRelayedUsage(cutoff: Date): Promise<number> {
  return usageStore.pruneRelayedBefore(cutoff);
}

const METER_MAPPING: MeterMapping = {
  ai_tokens: env.STRIPE_METER_AI_TOKENS,
  scans: env.STRIPE_METER_SCANS,
  storage_mb: env.STRIPE_METER_STORAGE_MB,
};

// 릴레이의 outbound 의존 — 주입 가능(hex 포트)해서 Stripe 없이 double-billing 경로를 테스트.
type RelayDeps = {
  getCustomerId: (orgId: string) => Promise<string | null>;
  recordMeterEvent: (e: {
    eventName: string;
    customerId: string;
    value: number;
    identifier: string;
    timestampSec: number;
  }) => Promise<void>;
  mapping: MeterMapping;
};
const defaultDeps: RelayDeps = { getCustomerId, recordMeterEvent, mapping: METER_MAPPING };

type RelayResult = {
  relayed: number;
  markedNonBillable: number;
  deferredNoCustomer: number;
  deferredNoMeter: number;
  droppedTooOld: number;
  failed: number;
  quarantined: number;
};

/**
 * 미릴레이 usage → Stripe Billing Meter 전송 (cron 배치).
 * 이중청구 방지: 전송 직전 relayAttemptedAt 기록(claim) → 전송 → relayedAt 마킹.
 *   마킹이 유실돼도 다음 배치가 SAFE_RESEND_MS(20h<24h) 내면 Stripe 멱등(identifier)이
 *   중복을 흡수하고, 그 밖이면 격리(quarantine)해 재전송하지 않는다(수동 대사).
 * 한 행 실패는 그 행만 격리(에러 격리) — 배치 전체가 죽지 않음.
 *  - 고객 없음+유예 내: 보류(웹훅이 곧 고객 붙임)   - 유예 초과: free 확정 마킹
 *  - meter 미설정: 보류(유실 방지)                 - 35일 초과: 마킹+로깅(소액 유실)
 */
export async function relayUsage(
  limit = 500,
  deps: RelayDeps = defaultDeps,
): Promise<RelayResult> {
  const now = new Date();
  const attemptCutoff = new Date(now.getTime() - SAFE_RESEND_MS);
  const rows = await usageStore.listRelayable(limit, attemptCutoff);
  let relayed = 0;
  let markedNonBillable = 0;
  let deferredNoCustomer = 0;
  let deferredNoMeter = 0;
  let droppedTooOld = 0;
  let failed = 0;

  const customerCache = new Map<string, string | null>();
  const customerOf = async (orgId: string): Promise<string | null> => {
    if (!customerCache.has(orgId)) customerCache.set(orgId, await deps.getCustomerId(orgId));
    return customerCache.get(orgId) ?? null;
  };

  for (const row of rows) {
    try {
      // 35일 초과분: Stripe 거부 → 재시도 무한루프/이중청구 방지 위해 완료 마킹.
      if (isTooOldToMeter(row.at, now)) {
        console.error(`[usage] event ${row.id} > 35d old — cannot meter, dropping (revenue loss)`);
        await usageStore.markRelayed([row.id], now);
        droppedTooOld++;
        continue;
      }
      const customerId = await customerOf(row.orgId);
      const eventName = meterEventName(row.metric as UsageMetric, deps.mapping);
      const action = decideRelay(customerId, eventName, isPastNoCustomerGrace(row.at, now));

      if (action.kind === 'mark-nonbillable') {
        await usageStore.markRelayed([row.id], now);
        markedNonBillable++;
      } else if (action.kind === 'defer-no-customer') {
        deferredNoCustomer++;
      } else if (action.kind === 'defer-no-meter') {
        console.warn(`[usage] no meter for metric "${row.metric}" — deferring ${row.id}`);
        deferredNoMeter++;
      } else {
        await usageStore.markAttempted([row.id], now); // ★전송 직전 claim
        await deps.recordMeterEvent({
          eventName: action.eventName,
          customerId: action.customerId,
          value: row.quantity,
          identifier: row.idempotencyKey,
          timestampSec: Math.floor(row.at.getTime() / 1000),
        });
        await usageStore.markRelayed([row.id], now);
        relayed++;
      }
    } catch (e) {
      // 이 행만 실패 격리 — attempt는 이미 찍혔으므로 20h 내 재시도, 밖이면 quarantine.
      console.error(`[usage] relay failed for ${row.id}:`, e);
      failed++;
    }
  }

  const quarantined = await usageStore.countQuarantined(attemptCutoff);
  if (quarantined > 0) {
    console.error(`[usage] ${quarantined} events quarantined (attempted but unmarked >20h — needs reconciliation)`);
  }
  return {
    relayed, markedNonBillable, deferredNoCustomer, deferredNoMeter,
    droppedTooOld, failed, quarantined,
  };
}
