import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

// 아키텍처 불변량 (ARCHITECTURE.md §4) — lint로 강제:
//   1. 크로스 feature 접근은 그 feature의 index.ts(공개 API)로만
//   2. domain/ 은 외부 의존 0 (같은 feature의 domain만 import 가능)
export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/.turbo/**', '**/dist/**', '**/drizzle/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    ignores: ['**/__tests__/**', '**/*.test.ts'],
    plugins: { boundaries },
    settings: {
      // 확장자 없는 TS import 해석 (이거 없으면 element-types 룰이 통째로 무력화됨)
      'import/resolver': {
        node: { extensions: ['.ts', '.tsx'] },
      },
      'boundaries/include': ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
      'boundaries/elements': [
        {
          type: 'domain',
          pattern: 'apps/*/src/features/*/domain/**/*',
          mode: 'full',
          capture: ['app', 'feature'],
        },
        {
          type: 'feature-public',
          pattern: 'apps/*/src/features/*/index.ts',
          mode: 'full',
          capture: ['app', 'feature'],
        },
        {
          type: 'feature',
          pattern: 'apps/*/src/features/*/**/*',
          mode: 'full',
          capture: ['app', 'feature'],
        },
        {
          type: 'app-lib',
          pattern: 'apps/*/src/**/*',
          mode: 'full',
          capture: ['app'],
        },
        {
          type: 'package',
          pattern: 'packages/*/src/**/*',
          mode: 'full',
          capture: ['pkg'],
        },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message:
            '${file.type} → ${dependency.type} import 금지. 크로스 feature는 index.ts로만, domain은 순수하게.',
          rules: [
            // domain: 같은 feature의 domain만 (순수 로직 — drizzle/hono/vendor 금지)
            {
              from: ['domain'],
              allow: [['domain', { feature: '${from.feature}' }]],
            },
            // feature 내부 파일: 자기 feature 전부 + 남의 feature는 index.ts만 + lib/packages
            {
              from: ['feature'],
              allow: [
                ['feature', { feature: '${from.feature}' }],
                ['domain', { feature: '${from.feature}' }],
                'feature-public',
                'app-lib',
                'package',
              ],
            },
            {
              from: ['feature-public'],
              allow: [
                ['feature', { feature: '${from.feature}' }],
                ['domain', { feature: '${from.feature}' }],
                'feature-public',
                'app-lib',
                'package',
              ],
            },
            // 앱 조립층(app.ts, lib/): feature 내부 직접 접근 금지
            {
              from: ['app-lib'],
              allow: ['feature-public', 'app-lib', 'package'],
            },
            { from: ['package'], allow: ['package'] },
          ],
        },
      ],
      // domain은 npm 패키지도 금지 (순수 TS만)
      'boundaries/external': [
        'error',
        {
          default: 'allow',
          rules: [{ from: ['domain'], disallow: ['*'] }],
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
