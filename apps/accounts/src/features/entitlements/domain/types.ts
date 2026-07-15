// domain — 외부 의존 0. zod도 drizzle도 여기 못 들어옴 (lint 강제).
export type PlanId = 'free' | 'team' | 'business' | 'enterprise';
export type OrgRole = 'owner' | 'admin' | 'member' | 'billing' | 'guest';

export type Entitlements = {
  plan: PlanId;
  role: OrgRole;
  maxSeats: number;
  aiTokensPerMonth: number;
  scansPerMonth: number;
  features: string[];
};
