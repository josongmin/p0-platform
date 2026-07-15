import { z } from 'zod';
import { planId } from './billing';

// JWT 클레임에 그대로 박히는 형태 — 제품 API들은 이걸 로컬 검증만으로 읽는다.
export const entitlementClaims = z.object({
  org: z.string().nullable(),
  plan: planId,
  role: z.enum(['owner', 'admin', 'member', 'billing', 'guest']),
  maxSeats: z.number().int(),
  aiTokensPerMonth: z.number().int(),
  scansPerMonth: z.number().int(),
  features: z.array(z.string()),
});
export type EntitlementClaims = z.infer<typeof entitlementClaims>;
