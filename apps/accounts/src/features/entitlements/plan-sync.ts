// 컴파일 타임 드리프트 가드 — domain은 contracts를 import 못 하므로(순수 규칙)
// 이 non-domain 파일에서 두 SSOT의 정합을 강제한다.
//   • contracts(JWT 클레임의 SSOT)에 plan을 추가하고 PLAN_TABLE 갱신을 깜빡하면
//     아래 Record가 키 누락으로 컴파일 에러를 낸다.
import type { PlanId as ContractPlanId } from '@p0/contracts';
import { PLAN_TABLE } from './domain/policy';

// 모든 contracts PlanId ↔ PLAN_TABLE 키 1:1 (한쪽만 바뀌면 타입 에러)
export const PLAN_COVERAGE: Record<ContractPlanId, keyof typeof PLAN_TABLE> = {
  free: 'free',
  team: 'team',
  business: 'business',
  enterprise: 'enterprise',
};
