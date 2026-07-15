import { z } from 'zod';

// 제품(intel/llm-gateway/runner)이 accounts로 쏘는 미터링 이벤트.
export const usageMetric = z.enum(['ai_tokens', 'scans', 'storage_mb']);
export type UsageMetric = z.infer<typeof usageMetric>;

export const usageEvent = z.object({
  orgId: z.string().min(1),
  metric: usageMetric,
  quantity: z.number().positive(),
  at: z.string().datetime(),
  // 제품 쪽에서 생성 — 재전송 안전(중복 삽입 무시)
  idempotencyKey: z.string().min(8),
});
export type UsageEvent = z.infer<typeof usageEvent>;
