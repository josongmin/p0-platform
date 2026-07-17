// driven adapter — accounts /v1/usage 로 미터링 이벤트 발행 (서비스키).
import { newId } from '@p0/shared';
import type { UsageMetric } from '@p0/contracts';
import { env } from '../../../lib/env';

/** usage 이벤트 발행. idempotencyKey로 중복 방지. 실패는 throw(호출측이 격리). */
export async function emitUsage(input: {
  orgId: string;
  metric: UsageMetric;
  quantity: number;
}): Promise<void> {
  const res = await fetch(`${env.ACCOUNTS_URL}/v1/usage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.GATEWAY_SERVICE_KEY ?? '' },
    body: JSON.stringify({
      orgId: input.orgId,
      metric: input.metric,
      quantity: input.quantity,
      at: new Date().toISOString(),
      idempotencyKey: newId('gw'),
    }),
  });
  if (!res.ok) throw new Error(`usage emit failed: ${res.status}`);
}
