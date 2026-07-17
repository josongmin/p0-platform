// 리텐션 정책 (순수) — 무한증가 테이블의 보존기간. 컷오프 계산만 여기서, 실제 삭제는
// 각 feature store.pruneBefore(cutoff)가 수행한다.
export const RETENTION_DAYS = {
  audit: 365, // 감사: 1년 (컴플라이언스)
  usage: 180, // 릴레이 완료된 미터링: 6개월
  stripeEvents: 90, // webhook 멱등 원장: Stripe 재시도 윈도우(~3일) 훨씬 넘겨서
} as const;

export function cutoffDate(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60_000);
}
