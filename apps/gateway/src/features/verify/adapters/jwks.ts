// driven adapter — accounts의 JWKS로 JWT 로컬검증 (jose). accounts 런타임 호출 없음.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../../../lib/env';

// jose가 JWKS를 캐시/로테이션 처리. accounts의 /api/auth/jwks 를 가리킨다.
const jwks = createRemoteJWKSet(new URL(`${env.ACCOUNTS_URL}/api/auth/jwks`));

/**
 * JWT 서명검증 + payload 반환. 실패 시 throw.
 *  - algorithms 핀(EdDSA): alg 혼동/none 공격 차단 (accounts는 EdDSA 서명).
 *  - issuer 핀: accounts가 발급한 토큰만 수락 (다른 서비스/용도 토큰 replay 차단, H1).
 * (sig·exp·nbf는 jose가 기본 검증.)
 */
export async function verifyJwt(token: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ['EdDSA'],
    issuer: env.ACCOUNTS_URL,
  });
  return payload as Record<string, unknown>;
}
