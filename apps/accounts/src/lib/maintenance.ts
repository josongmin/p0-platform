// 리텐션 프루닝 오케스트레이터 — 무한증가 테이블을 정책대로 정리한다.
// cron/스케줄러가 runRetentionPrune()을 주기 호출 (예: 일 1회). 각 feature의
// 공개 prune API만 호출 (composition-level 배선).
import { pruneAuditLog } from '../features/audit';
import { pruneStripeEvents } from '../features/billing';
import { pruneRelayedUsage } from '../features/usage';
import { cutoffDate, RETENTION_DAYS } from './retention';

// 테이블별 결과 — 한 테이블 실패가 다른 테이블 프루닝을 막지 않도록 allSettled.
type TableResult = { ok: true; deleted: number } | { ok: false; error: string };
type PruneResult = {
  audit: TableResult;
  usage: TableResult;
  stripeEvents: TableResult;
  anyFailed: boolean;
};

function settle(r: PromiseSettledResult<number>): TableResult {
  return r.status === 'fulfilled'
    ? { ok: true, deleted: r.value }
    : { ok: false, error: String(r.reason) };
}

export async function runRetentionPrune(now: Date = new Date()): Promise<PruneResult> {
  const [audit, usage, stripeEvents] = await Promise.allSettled([
    pruneAuditLog(cutoffDate(now, RETENTION_DAYS.audit)),
    // ⚠️ usage는 relayedAt IS NOT NULL만 삭제 — 릴레이 워커 미구현 상태에선 항상 0건
    // (미청구 usage 유실 방지). 릴레이 워커 생기기 전까지 usage_events는 무한증가한다.
    pruneRelayedUsage(cutoffDate(now, RETENTION_DAYS.usage)),
    pruneStripeEvents(cutoffDate(now, RETENTION_DAYS.stripeEvents)),
  ]);
  const result = {
    audit: settle(audit),
    usage: settle(usage),
    stripeEvents: settle(stripeEvents),
  };
  return { ...result, anyFailed: Object.values(result).some((r) => !r.ok) };
}
