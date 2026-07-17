// hex 포트 — append-only 감사 저장소.
export type AuditEntry = {
  id: string;
  orgId: string;
  actor: string;
  action: string;
  target: string | null;
  payload: unknown;
  ip: string | null;
  at: Date;
};

export interface AuditStore {
  append(entry: AuditEntry): Promise<void>;
  list(orgId: string, opts: { limit: number }): Promise<AuditEntry[]>;
  /** cutoff 이전 로그 삭제 (리텐션). 삭제 건수 반환. */
  pruneBefore(cutoff: Date): Promise<number>;
}
