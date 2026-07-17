import { z } from 'zod';

// 제품 API(gateway)는 accounts에 런타임 의존을 최소화한다:
//  - JWT는 JWKS로 로컬검증 (인증마다 accounts 호출 안 함)
//  - epoch/usage만 accounts 서비스 API 호출 (짧은 캐시)
const schema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(4100),
  ACCOUNTS_URL: z.string().default('http://localhost:4000'),
  // accounts가 발급한 서비스 키(metadata.orgId) — usage 발행·epoch 조회에 사용.
  // required: 없으면 usage/epoch 호출이 전부 fail-closed로 죽으므로 boot 시 실패시킨다(M2).
  // ⚠️ org-스코프 키라 이 게이트웨이 인스턴스는 한 org를 섬긴다(데모). 멀티org는
  //    글로벌 read 키 + org별 write 키 or 배치 엔드포인트 필요(README 한계 참조).
  GATEWAY_SERVICE_KEY: z.string().min(1),
  // epoch 캐시 TTL(ms) — 짧을수록 revocation 빠름, accounts 부하↑. 기본 10s.
  EPOCH_CACHE_TTL_MS: z.coerce.number().int().positive().default(10_000),
});

export const env = schema.parse(process.env);
