import type { PlanId, SubscriptionStatus, UsageEvent } from '@p0/contracts';

// 인프로세스 이벤트 버스 — feature 간 결합 없이 통신하는 두 번째 통로(index.ts 외).
// 슬라이스가 별도 서비스로 분가할 때 이 계약이 그대로 큐 토픽이 된다.
export type AccountsEvents = {
  'billing.subscription.updated': {
    orgId: string;
    plan: PlanId;
    status: SubscriptionStatus;
  };
  'usage.recorded': UsageEvent;
};

type Handler<T> = (payload: T) => void | Promise<void>;

const handlers = new Map<keyof AccountsEvents, Set<Handler<never>>>();

export const bus = {
  on<K extends keyof AccountsEvents>(event: K, handler: Handler<AccountsEvents[K]>): void {
    const set = handlers.get(event) ?? new Set();
    set.add(handler as Handler<never>);
    handlers.set(event, set);
  },
  emit<K extends keyof AccountsEvents>(event: K, payload: AccountsEvents[K]): void {
    for (const handler of handlers.get(event) ?? []) {
      // 각 핸들러의 거부를 반드시 삼켜서 로깅한다 — 안 그러면 audit insert 실패 같은
      // 비동기 거부가 unhandledRejection으로 프로세스를 죽이거나 조용히 유실된다.
      Promise.resolve()
        .then(() => (handler as Handler<AccountsEvents[K]>)(payload))
        .catch((e) => console.error(`[bus] handler failed for "${event}":`, e));
    }
  },
};
