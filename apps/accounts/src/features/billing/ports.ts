// hex 포트 — billing 유스케이스가 바깥에 요구하는 것.

export type BillingRow = {
  orgId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: string;
  status: string;
  currentPeriodEnd: Date | null;
  watermark: number | null;
};

export interface BillingStore {
  get(orgId: string): Promise<BillingRow | null>;
  getByCustomerId(customerId: string): Promise<BillingRow | null>;
  upsert(row: BillingRow): Promise<void>;
  /**
   * webhook 멱등+원자성: event.id 기록과 org_billing upsert를 한 트랜잭션으로.
   * 처음 보는 event.id면 upsert하고 true, 중복이면 아무것도 안 하고 false.
   * upsert가 실패하면 event.id 기록도 롤백 → Stripe 재시도가 다시 처리한다 (R3).
   */
  applyWebhook(eventId: string, row: BillingRow): Promise<boolean>;
  /**
   * org_billing upsert 없이 event.id만 멱등 기록 (dunning 등 비-구독 이벤트용).
   * 처음이면 true, 중복이면 false → Stripe 재시도로 dunning 메일 중복발송 방지.
   */
  markEventProcessed(eventId: string): Promise<boolean>;
  /** cutoff 이전 stripe_events(멱등 원장) 삭제. 삭제 건수 반환. */
  pruneEventsBefore(cutoff: Date): Promise<number>;
}

export interface CheckoutGateway {
  createSession(input: {
    orgId: string;
    priceId: string;
    customerId: string | null;
  }): Promise<{ url: string }>;
}

export interface PortalGateway {
  createSession(input: { customerId: string }): Promise<{ url: string }>;
}

export interface SubscriptionGateway {
  cancel(subscriptionId: string): Promise<void>;
}
