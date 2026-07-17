import { addUsed, getUsed } from './adapters/counter';
import { decideQuota, type QuotaDecision } from './domain/quota';

/** 요청량이 org 한도 내인지 (서버측 라이브 카운터 대조). */
export function checkQuota(orgId: string, requested: number, limit: number): QuotaDecision {
  return decideQuota(getUsed(orgId), requested, limit);
}

/** 소비 확정 — 카운터 증가 (allow 후 호출). */
export function commitUsage(orgId: string, amount: number): void {
  addUsed(orgId, amount);
}
