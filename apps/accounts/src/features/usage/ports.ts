// hex 포트 — usage 유스케이스가 바깥에 요구하는 것.
export type UsageRecord = {
  id: string;
  orgId: string;
  metric: string;
  quantity: number;
  at: Date;
  idempotencyKey: string;
};

export type UnrelayedEvent = {
  id: string;
  orgId: string;
  metric: string;
  quantity: number;
  at: Date; // 미터 이벤트 timestamp — 정확한 청구기간 배정에 필수
  idempotencyKey: string;
};

export interface UsageStore {
  /** 멱등 삽입 — idempotencyKey 충돌은 조용히 무시 */
  insert(record: UsageRecord): Promise<void>;
  /** 릴레이 완료(relayedAt != null) & cutoff 이전 이벤트 삭제. 삭제 건수 반환. */
  pruneRelayedBefore(cutoff: Date): Promise<number>;
  /**
   * 릴레이 대상 조회 (오래된 순, limit): 미릴레이 AND (미시도 OR 시도가 attemptCutoff 이후).
   * 시도했지만 attemptCutoff 이전인 행은 격리(quarantine) — Stripe 멱등 윈도우 밖 재전송
   * 이중청구를 막기 위해 자동 릴레이에서 제외한다.
   */
  listRelayable(limit: number, attemptCutoff: Date): Promise<UnrelayedEvent[]>;
  /** Stripe 전송 직전 첫 시도 시각 기록 (relayAttemptedAt IS NULL일 때만). */
  markAttempted(ids: string[], at: Date): Promise<void>;
  /** 릴레이 완료 마킹 (relayedAt = at). */
  markRelayed(ids: string[], at: Date): Promise<void>;
  /** 격리 건수 — 시도했으나 미릴레이 & attemptCutoff 이전(수동 대사 필요, 알림용). */
  countQuarantined(attemptCutoff: Date): Promise<number>;
}
