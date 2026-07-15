// hex 포트 — usage 유스케이스가 바깥에 요구하는 것.
export type UsageRecord = {
  id: string;
  orgId: string;
  metric: string;
  quantity: number;
  at: Date;
  idempotencyKey: string;
};

export interface UsageStore {
  /** 멱등 삽입 — idempotencyKey 충돌은 조용히 무시 */
  insert(record: UsageRecord): Promise<void>;
}
