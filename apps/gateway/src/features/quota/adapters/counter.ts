// driven adapter — org별 당월 사용량 카운터 (데모: in-memory. 프로덕션은 Redis/DB).
// 서버측 라이브 값이라 JWT 스냅샷과 독립적으로 초과과금을 막는다.
type Bucket = { period: string; used: number };
const buckets = new Map<string, Bucket>();

function periodKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

export function getUsed(orgId: string, now: () => number = Date.now): number {
  const b = buckets.get(orgId);
  const p = periodKey(now());
  if (!b || b.period !== p) return 0; // 월 바뀌면 리셋
  return b.used;
}

export function addUsed(orgId: string, amount: number, now: () => number = Date.now): void {
  const p = periodKey(now());
  const b = buckets.get(orgId);
  if (!b || b.period !== p) buckets.set(orgId, { period: p, used: amount });
  else b.used += amount;
}

export function _resetCounters(): void {
  buckets.clear();
}
