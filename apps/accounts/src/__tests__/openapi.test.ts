// RED → src/openapi.ts + /openapi.json 라우트가 구현 대상.
import { describe, expect, test } from 'bun:test';
import { app } from '../app';

describe('OpenAPI 발행', () => {
  test('/openapi.json — 3.1 문서 + /v1 경로 + 컴포넌트 스키마', async () => {
    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi.startsWith('3.1')).toBe(true);
    expect(doc.paths['/v1/billing/{orgId}']).toBeDefined();
    expect(doc.paths['/v1/billing/{orgId}/checkout']).toBeDefined();
    expect(doc.paths['/v1/entitlements/{orgId}']).toBeDefined();
    expect(doc.paths['/v1/usage']).toBeDefined();
    expect(doc.paths['/v1/audit/{orgId}']).toBeDefined();
    expect(doc.components.schemas.CheckoutRequest).toBeDefined();
    expect(doc.components.schemas.EntitlementClaims).toBeDefined();
  });
});
