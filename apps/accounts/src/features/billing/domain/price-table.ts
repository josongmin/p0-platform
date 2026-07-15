// domain — env → price 테이블. placeholder 금지: 미설정 plan은 테이블에 없어야
// createCheckout이 명시적으로 실패한다 (조용히 잘못된 price로 결제되는 사고 방지).
export type PriceEnv = {
  teamMonthly?: string;
  teamAnnual?: string;
  businessMonthly?: string;
  businessAnnual?: string;
};

export function buildPriceTable(ids: PriceEnv): Record<string, string> {
  const table: Record<string, string> = {};
  if (ids.teamMonthly) table['team:monthly'] = ids.teamMonthly;
  if (ids.teamAnnual) table['team:annual'] = ids.teamAnnual;
  if (ids.businessMonthly) table['business:monthly'] = ids.businessMonthly;
  if (ids.businessAnnual) table['business:annual'] = ids.businessAnnual;
  return table;
}
