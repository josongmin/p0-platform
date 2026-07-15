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
  /** webhook 멱등: event.id를 처음 기록하면 true, 이미 있으면 false(=중복) */
  markEventProcessed(eventId: string): Promise<boolean>;
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
