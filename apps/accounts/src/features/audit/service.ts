// 유스케이스 — 기록·조회 + 버스 구독 (구독 등록은 composition root에서 호출).
import { newId } from '@p0/shared';
import { bus } from '../../lib/events';
import { auditStore } from './adapters/store';
import type { AuditEntry } from './ports';

export async function recordAudit(input: {
  orgId: string;
  actor: string;
  action: string;
  target?: string;
  payload?: unknown;
  ip?: string;
}): Promise<void> {
  await auditStore.append({
    id: newId('aud'),
    orgId: input.orgId,
    actor: input.actor,
    action: input.action,
    target: input.target ?? null,
    payload: input.payload ?? null,
    ip: input.ip ?? null,
    at: new Date(),
  });
}

export async function listAudit(
  orgId: string,
  limit = 50,
): Promise<AuditEntry[]> {
  // 라우트에서 이미 클램프하지만 다른 호출자 대비 방어적으로 한 번 더
  const safe = Number.isFinite(limit) ? Math.min(Math.max(1, limit), 200) : 50;
  return auditStore.list(orgId, { limit: safe });
}

/** 도메인 이벤트 → 감사기록. app.ts(composition root)에서 1회 호출. */
export function registerAuditSubscriptions(): void {
  bus.on('billing.subscription.updated', (p) =>
    recordAudit({
      orgId: p.orgId,
      actor: 'system:stripe',
      action: 'billing.subscription.updated',
      payload: p,
    }),
  );
}
