# p0-platform

p0 백엔드 모노레포 — 운영(accounts: 인증·조직·구독·미터링)부터 시작해
제품 백엔드(intel, llm-gateway, runner)까지 담는다.
구조 원칙은 [ARCHITECTURE.md](./ARCHITECTURE.md).

## Quickstart

```bash
docker compose up -d          # postgres(5432) + redis(6379)
cp .env.example .env          # BETTER_AUTH_SECRET 등 채우기
bun install
bun run db:push               # drizzle 스키마 → DB
bun run dev                   # accounts: http://localhost:4000
```

확인:

```bash
curl localhost:4000/health                 # {"ok":true,"service":"accounts"}
open http://localhost:4000/api/auth/reference   # better-auth 엔드포인트들
curl localhost:4000/api/auth/jwks          # 제품 API가 쓰는 JWKS
```

## Scripts

| 명령 | 설명 |
|---|---|
| `bun run dev` | 전체 dev (turbo) |
| `bun run typecheck` / `lint` / `test` | 검증 3종 |
| `bun run db:push` | drizzle 스키마 push (개발용) |
| `bun run auth:generate` | better-auth 플러그인 변경 시 auth 스키마 재생성 |

## apps/accounts — 현재 상태 (전 슬라이스 헥사고날)

| feature | 상태 |
|---|---|
| auth | better-auth 1.6 — org·teams·2FA·multi-session·apiKey·admin·JWT/JWKS. 권한 매트릭스 SSOT = `domain/roles.ts`, 가드 4종(`lib/guard.ts`) |
| billing | Stripe checkout·**customer portal**·webhook. Price는 env 주입 (`STRIPE_PRICE_*`) |
| entitlements | plan×role → JWT 클레임 (`definePayload` 주입) |
| usage | 미터링 적재 (멱등) + `x-api-key` 가드 — Stripe meter 릴레이 TODO |
| email | Resend(fetch, SDK 없음) + **콘솔 폴백** — 인증·리셋·초대 메일 배선 완료 |
| audit | append-only 감사 로그 — 버스 이벤트 구독 + `GET /v1/audit/:orgId` (owner·admin) |

OpenAPI: `GET /openapi.json` → FE codegen:
`bunx openapi-typescript http://localhost:4000/openapi.json -o api.d.ts`

## TODO (다음 순서)

- [ ] Stripe 대시보드에서 Price 생성 → `.env`의 `STRIPE_PRICE_*` 채우기
- [ ] prod env: `REQUIRE_EMAIL_VERIFICATION=true` + Resend 도메인 인증
- [ ] usage → Stripe Billing Meters 릴레이 워커 (`relayedAt` 마킹)
- [ ] audit: better-auth 훅 이벤트(로그인·멤버변경) 수집 확대
- [ ] FE(se-dot-field) auth-stage를 better-auth client SDK로 배선
