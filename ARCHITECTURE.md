# p0-platform 아키텍처

p0의 백엔드 모노레포. **일단 퉁쳐놓고, 필요할 때 쪼갠다** — 단 아래 경계 규칙을
지킨 상태로 퉁친다. 규칙이 지켜지면 슬라이스 분가(별도 서비스/레포)는 이사 수준이 된다.

관련 레포: `quanta-index`(검색/인덱싱 엔진, Rust — 별도 유지), `se-dot-field`(제품 FE).

## 레이아웃

```
apps/
  accounts/            운영 API — 인증·조직·구독·미터링 (better-auth + Stripe)
  intel/         (예정) 코드인텔 — SCM webhook·ingest·metrics 워커
  llm-gateway/   (예정) LLM 프록시·비용계측
  runner/        (예정) 샌드박스 실행
packages/
  contracts/     zod 스키마 SSOT — API 계약·이벤트 payload. FE/BE 공유
  db/            drizzle 스키마 + 마이그레이션 (Postgres 1개, 테이블 소유권은 feature 단위)
  shared/        Result 타입 등 공용 유틸
```

## 슬라이싱 규칙 — feature 슬라이스 × 헥사고날

모든 app은 `src/features/<name>/` 로 수직 분할하고, 슬라이스 내부는 **헥사고날**이 표준:

```
features/<name>/
  domain/      순수 로직 — 외부 의존 0 (npm 패키지·벤더 SDK 금지), 목 없이 단위테스트
  ports.ts     유스케이스가 바깥에 요구하는 인터페이스
  adapters/    ports 구현 — drizzle·Stripe·better-auth 등 벤더는 전부 여기 갇힌다
  service.ts   유스케이스 — domain + ports(adapters) 조립
  routes.ts    HTTP 어댑터: 파싱 → service → 직렬화만
  index.ts     ★ 공개 API — 외부에서 import 가능한 유일한 파일
```

- 벤더가 로직을 소유하는 글루 슬라이스(auth·billing)도 같은 골격을 쓰되 domain/이
  얇거나 없을 수 있다 — 단 **벤더 SDK 타입이 adapters/ 밖으로 새면 안 된다.**
- 순수 규칙이 생기는 순간 domain/으로 승격한다 (예: billing의 Stripe status 매핑,
  auth의 권한 매트릭스).
- **feature 간 배선은 composition root(app.ts)에서만.** 순환 위험이 있는 의존
  (auth의 JWT 클레임 ← entitlements)은 늦은 바인딩 레지스트리로 주입한다
  (`setClaimsBuilder` 패턴).

예시: 권한 매트릭스의 SSOT는 `auth/domain/roles.ts`(순수)이고, better-auth의
access-control 객체는 `auth/adapters/access-control.ts`가 매트릭스에서 **파생**한다.

## 불변량 (eslint boundaries로 강제 — eslint.config.mjs)

1. **크로스 feature 접근은 그 feature의 `index.ts`로만.** 딥 임포트 = lint 에러.
2. **`domain/`은 순수.** 같은 feature의 domain만 import 가능. npm 패키지 금지.
3. **테이블 소유권**: `packages/db/schema/<feature>.ts` — 쓰기는 소유 feature만,
   타 feature는 공개 API로 읽는다. (컨벤션 — 리뷰로 지킴)
4. feature 간 비동기 통신은 `lib/events.ts` 버스로. 이벤트 payload는 contracts 타입.
   분가 시 이 계약이 그대로 큐 토픽이 된다.

## 서비스 간 계약 (분가 후에도 유지되는 3개)

1. **OIDC/JWT**: accounts가 IdP. JWT에 `org/plan/role/한도` 클레임
   (entitlements가 definePayload에서 주입). 제품 API는 JWKS(`/api/auth/jwks`)
   로컬검증만 — 런타임에 accounts 호출 없음.
2. **사용량 이벤트** (제품→accounts): `POST /usage` (contracts의 `usageEvent`).
3. **Entitlement 변경 전파** (accounts→제품): JWT 클레임 갱신 (필요 시 webhook 추가).

## 스키마 재생성

better-auth 플러그인 구성을 바꾸면:

```
bun run auth:generate   # packages/db/src/schema/auth.ts 덮어씀
bun run db:push         # 개발 DB 반영
```
