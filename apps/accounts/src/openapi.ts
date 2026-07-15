// OpenAPI 3.1 발행 — 계약 SSOT는 @p0/contracts의 zod 스키마.
// FE codegen: bunx openapi-typescript http://localhost:4000/openapi.json -o api.d.ts
import {
  checkoutRequest,
  entitlementClaims,
  orgBillingStatus,
  usageEvent,
} from '@p0/contracts';
import { zodToJsonSchema } from 'zod-to-json-schema';

const toSchema = (s: Parameters<typeof zodToJsonSchema>[0]) =>
  zodToJsonSchema(s, { target: 'openApi3', $refStrategy: 'none' });

const orgIdParam = {
  name: 'orgId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
};

const json = (ref: string) => ({
  content: { 'application/json': { schema: { $ref: ref } } },
});

export function buildOpenApiDoc() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'p0 accounts API',
      version: '0.1.0',
      description:
        '운영 API — 인증은 /api/auth/* (better-auth 규약), 비즈니스는 /v1/*. ' +
        '웹은 쿠키 세션, 서비스 간은 x-api-key, 제품 API는 /api/auth/jwks 로컬검증.',
    },
    paths: {
      '/v1/billing/{orgId}': {
        get: {
          summary: '구독 상태 조회',
          description: '권한: billing.read (owner·admin·billing)',
          parameters: [orgIdParam],
          responses: {
            '200': {
              description: 'ok',
              ...json('#/components/schemas/OrgBillingStatus'),
            },
          },
        },
      },
      '/v1/billing/{orgId}/checkout': {
        post: {
          summary: 'Stripe checkout 세션 생성',
          description: '권한: billing.manage (owner·billing)',
          parameters: [orgIdParam],
          requestBody: json('#/components/schemas/CheckoutRequest'),
          responses: { '200': { description: '{ url }' } },
        },
      },
      '/v1/billing/{orgId}/portal': {
        post: {
          summary: 'Stripe customer portal 세션',
          description: '권한: billing.manage',
          parameters: [orgIdParam],
          responses: {
            '200': { description: '{ url }' },
            '400': { description: '결제 이력 없음' },
          },
        },
      },
      '/v1/entitlements/{orgId}': {
        get: {
          summary: 'plan×role 엔타이틀먼트 (JWT 클레임과 동일)',
          description: '권한: org 멤버',
          parameters: [orgIdParam],
          responses: {
            '200': {
              description: 'ok',
              ...json('#/components/schemas/EntitlementClaims'),
            },
          },
        },
      },
      '/v1/usage': {
        post: {
          summary: '미터링 이벤트 적재 (멱등)',
          description: '인증: x-api-key (서비스 키)',
          requestBody: json('#/components/schemas/UsageEvent'),
          responses: { '200': { description: 'ok' } },
        },
      },
      '/v1/audit/{orgId}': {
        get: {
          summary: '감사 로그 조회 (최신순)',
          description: '권한: audit.read (owner·admin)',
          parameters: [
            orgIdParam,
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } },
          ],
          responses: { '200': { description: '{ entries }' } },
        },
      },
    },
    components: {
      schemas: {
        CheckoutRequest: toSchema(checkoutRequest),
        OrgBillingStatus: toSchema(orgBillingStatus),
        EntitlementClaims: toSchema(entitlementClaims),
        UsageEvent: toSchema(usageEvent),
      },
    },
  };
}
