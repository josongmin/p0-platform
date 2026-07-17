// feature 스캐폴더 — 올바른 hex 골격으로만 시작하게 한다 (ARCHITECTURE.md 슬라이싱 규칙).
//   bun run new:feature <app> <name>     예) bun run new:feature accounts webhook-relay
// 생성물: domain/ ports.ts adapters/ service.ts routes.ts index.ts __tests__/ + schema/<name>.ts
// 생성 직후 typecheck·lint·arch-check 그린이 보장되는 템플릿만 뱉는다.
const REPO_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

const [app, name] = [process.argv[2], process.argv[3]];
if (!app || !name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('usage: bun run new:feature <app> <kebab-name>');
  process.exit(2);
}
const appDir = `${REPO_ROOT}/apps/${app}`;
if (!(await Bun.file(`${appDir}/package.json`).exists())) {
  console.error(`✘ apps/${app} 없음`);
  process.exit(2);
}
const featureDir = `${appDir}/src/features/${name}`;
if (await Bun.file(`${featureDir}/index.ts`).exists()) {
  console.error(`✘ features/${name} 이미 존재`);
  process.exit(2);
}

const camel = name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const pascal = camel[0]!.toUpperCase() + camel.slice(1);

const filesToWrite: Record<string, string> = {
  [`${featureDir}/domain/${name}.ts`]: `// domain — 순수 로직만. 외부 의존 0 (npm·벤더 SDK 금지, lint 강제).
export function ${camel}Ready(): boolean {
  return true; // TODO: 진짜 도메인 결정으로 교체
}
`,
  [`${featureDir}/ports.ts`]: `// hex 포트 — 유스케이스가 바깥에 요구하는 것. 구현은 adapters/.
export interface ${pascal}Store {
  health(): Promise<boolean>; // TODO: 진짜 포트로 교체
}
`,
  [`${featureDir}/adapters/store.ts`]: `// driven adapter — drizzle/벤더 SDK는 여기 갇힌다.
// 테이블 쓰기는 packages/db/src/schema/${name}.ts 소유분만 (arch-check R1).
import type { ${pascal}Store } from '../ports';

export const ${camel}Store: ${pascal}Store = {
  health: async () => true, // TODO: drizzle 구현으로 교체
};
`,
  [`${featureDir}/service.ts`]: `// 유스케이스 — domain + ports(adapters) 조립.
import { ${camel}Store } from './adapters/store';
import { ${camel}Ready } from './domain/${name}';

export async function ${camel}Status(): Promise<{ ok: boolean }> {
  return { ok: ${camel}Ready() && (await ${camel}Store.health()) };
}
`,
  [`${featureDir}/routes.ts`]: `import { Hono } from 'hono';
import { ${camel}Status } from './service';

// TODO: 가드 필수 검토 — requireSession / requirePermission / requireServiceKey (lib/guard.ts)
export const ${camel}Routes = new Hono();

${camel}Routes.get('/${name}/health', async (c) => c.json(await ${camel}Status()));
`,
  [`${featureDir}/index.ts`]: `// 공개 API — 밖에서는 이 파일로만 접근.
export { ${camel}Routes } from './routes';
export { ${camel}Status } from './service';
`,
  [`${featureDir}/__tests__/${name}.test.ts`]: `import { describe, expect, test } from 'bun:test';
import { ${camel}Ready } from '../domain/${name}';

describe('${name} domain', () => {
  test('placeholder — 진짜 도메인 테스트로 교체하라', () => {
    expect(${camel}Ready()).toBe(true);
  });
});
`,
  [`${REPO_ROOT}/packages/db/src/schema/${name}.ts`]: `// ${name} feature 소유 테이블 — 쓰기는 features/${name}만 (arch-check R1).
// import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
// export const ${camel}Example = pgTable('${name.replace(/-/g, '_')}_example', { ... });
export {}; // 테이블 추가 전까지 모듈 마커 (지우면 TS2306)
`,
};

for (const [path, content] of Object.entries(filesToWrite)) {
  await Bun.write(path, content);
}

// schema/index.ts에 export 추가
const schemaIndexPath = `${REPO_ROOT}/packages/db/src/schema/index.ts`;
const schemaIndex = await Bun.file(schemaIndexPath).text();
const exportLine = `export * from './${name}';`;
if (!schemaIndex.includes(exportLine)) {
  const lines = schemaIndex.trimEnd().split('\n');
  lines.push(exportLine);
  await Bun.write(schemaIndexPath, `${lines.sort().join('\n')}\n`);
}

console.log(`✔ features/${name} 생성 (apps/${app})`);
console.log(`
다음 스텝 (안 하면 knip 라쳇이 문다):
  1. apps/${app}/src/app.ts 에 마운트:  app.route('/v1', ${camel}Routes)
  2. routes.ts 의 TODO 가드 결정 (인증 없는 라우트는 의도일 때만)
  3. domain 테스트를 진짜로 교체 — TDD: RED 먼저
  4. bun run typecheck && bun run arch && bun test`);
