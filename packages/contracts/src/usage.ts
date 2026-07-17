import { z } from 'zod';

// 제품(intel/llm-gateway/runner)이 accounts로 쏘는 미터링 이벤트.
export const usageMetric = z.enum(['ai_tokens', 'scans', 'storage_mb']);
export type UsageMetric = z.infer<typeof usageMetric>;

// 단일 이벤트 수량 상한 — 미터 오염/bigint 오버플로 방지 (제품 정책에 맞춰 조정).
// bigint 컬럼(number 모드) 안전 상한 << 2^53. 10억으로 넉넉히 캡.
export const MAX_USAGE_QUANTITY = 1_000_000_000;
// 미래로 5분, 과거로 90일까지만 — 청구 윈도우 밖 backdating/future-dating 차단.
const FUTURE_SKEW_MS = 5 * 60_000;
const MAX_BACKDATE_MS = 90 * 24 * 60 * 60_000;

export const usageEvent = z.object({
  orgId: z.string().min(1),
  metric: usageMetric,
  quantity: z.number().finite().positive().max(MAX_USAGE_QUANTITY),
  at: z
    .string()
    .datetime()
    .refine(
      (t) => {
        const ms = Date.parse(t);
        // 현재시각 대비 상대 검증은 파싱 시점 기준 (테스트는 now 근방 값 사용)
        const now = Date.now();
        return ms <= now + FUTURE_SKEW_MS && ms >= now - MAX_BACKDATE_MS;
      },
      { message: 'timestamp out of accepted window (>5m future or >90d past)' },
    ),
  // 제품 쪽에서 생성 — 재전송 안전(중복 삽입 무시)
  idempotencyKey: z.string().min(8),
});
export type UsageEvent = z.infer<typeof usageEvent>;
