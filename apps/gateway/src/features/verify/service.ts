import type { EntitlementClaims } from '@p0/contracts';
import { verifyJwt } from './adapters/jwks';
import { parseClaims } from './domain/claims';

type VerifyResult =
  | { ok: true; claims: EntitlementClaims }
  | { ok: false; reason: 'bad-signature' | 'bad-claims' };

/** Bearer 토큰 → 서명검증(JWKS 로컬) + 클레임 파싱. accounts 런타임 호출 없음. */
export async function verifyToken(token: string): Promise<VerifyResult> {
  let payload: Record<string, unknown>;
  try {
    payload = await verifyJwt(token);
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
  const claims = parseClaims(payload);
  if (!claims) return { ok: false, reason: 'bad-claims' };
  return { ok: true, claims };
}
