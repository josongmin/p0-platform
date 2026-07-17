// 아키텍처 불변량의 기계 심판 — 순수 bun, <1초.
// pre-commit(로컬 루프)과 CI 양쪽에서 돈다. eslint boundaries(크로스 feature·domain 순수)와
// semgrep(CI 레지스트리 룰)이 못 보는 나머지 불변량 담당:
//   R1 테이블 쓰기 소유권 — schema/<f>.ts의 테이블은 features/<f>만 쓴다
//   R2 벤더 SDK는 자기 feature의 adapters/ 밖 금지 (런타임 import만, type은 허용)
//   R3 process.env는 lib/env.ts만
//   R4 late-binding 배선(setClaimsBuilder 등)은 composition root(app.ts)만
//   R5 모든 feature는 index.ts(공개 API) 필수
import { Glob } from 'bun';

const REPO_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

type Violation = { file: string; line: number; rule: string; detail: string };
const violations: Violation[] = [];

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

const isTest = (rel: string): boolean =>
  rel.includes('__tests__') || rel.endsWith('.test.ts');

// ── 파일 수집 ──
const files: Array<{ rel: string; text: string }> = [];
for await (const rel of new Glob('apps/*/src/**/*.ts').scan({ cwd: REPO_ROOT })) {
  if (rel.includes('node_modules/')) continue;
  files.push({ rel, text: await Bun.file(`${REPO_ROOT}/${rel}`).text() });
}

// ── R1: 테이블 쓰기 소유권 ──
// schema/<name>.ts 의 pgTable export → 소유 feature = <name>
const tableOwner = new Map<string, string>();
for await (const rel of new Glob('packages/db/src/schema/*.ts').scan({
  cwd: REPO_ROOT,
})) {
  const base = rel.split('/').pop()!.replace(/\.ts$/, '');
  if (base === 'index') continue;
  const text = await Bun.file(`${REPO_ROOT}/${rel}`).text();
  for (const m of text.matchAll(/export const (\w+)\s*=\s*pgTable\(/g)) {
    tableOwner.set(m[1]!, base);
  }
}
// db./tx. 를 통한 쓰기만 매치 (Map.delete 등 오탐 방지). schema.X와 직접 import 별칭 둘 다.
const WRITE_RE = /\b(?:db|tx)\s*\.\s*(insert|update|delete)\(\s*(?:schema\s*\.\s*)?(\w+)/g;
for (const f of files) {
  if (isTest(f.rel)) continue;
  const feature = f.rel.match(/^apps\/[^/]+\/src\/features\/([^/]+)\//)?.[1] ?? null;
  for (const m of f.text.matchAll(WRITE_RE)) {
    const owner = tableOwner.get(m[2]!);
    if (!owner) continue;
    if (feature !== owner) {
      violations.push({
        file: f.rel,
        line: lineOf(f.text, m.index),
        rule: 'R1 table-ownership',
        detail: `${m[1]}(${m[2]}) — 소유자는 features/${owner}. 공개 API를 거쳐라`,
      });
    }
  }
}

// ── R2: 벤더 SDK adapters 밖 금지 ──
const VENDOR_RULES: Array<{ label: string; pkg: RegExp; allowed: RegExp }> = [
  {
    label: 'stripe',
    pkg: /^stripe$/,
    allowed: /\/features\/billing\/adapters\//,
  },
  {
    label: 'better-auth',
    pkg: /^(?:better-auth(?:\/.*)?|@better-auth\/.*)$/,
    allowed: /\/features\/auth\/adapters\//,
  },
];
const IMPORT_RE =
  /import\s+(type\s)?[^;]*?from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const f of files) {
  for (const m of f.text.matchAll(IMPORT_RE)) {
    if (m[1]) continue; // import type — 타입 결합은 허용
    const pkg = m[2] ?? m[3] ?? '';
    for (const rule of VENDOR_RULES) {
      if (rule.pkg.test(pkg) && !rule.allowed.test(`/${f.rel}`)) {
        violations.push({
          file: f.rel,
          line: lineOf(f.text, m.index),
          rule: 'R2 vendor-in-adapters',
          detail: `'${pkg}' 런타임 import — ${rule.label}는 해당 feature adapters/ 안에서만`,
        });
      }
    }
  }
}

// ── R3: process.env는 lib/env.ts만 ──
for (const f of files) {
  if (isTest(f.rel) || f.rel.endsWith('/lib/env.ts')) continue;
  for (const m of f.text.matchAll(/process\s*\.\s*env/g)) {
    violations.push({
      file: f.rel,
      line: lineOf(f.text, m.index),
      rule: 'R3 env-centralized',
      detail: 'process.env 직접 접근 — lib/env.ts(zod 검증)를 거쳐라',
    });
  }
}

// ── R4: late-binding 배선은 composition root만 ──
const WIRING_RULES: Array<{ fn: string; allowed: RegExp }> = [
  {
    fn: 'setClaimsBuilder',
    // 정의(claims.ts)·재수출(index.ts)·배선(app.ts)만 허용
    allowed: /(\/src\/app\.ts|\/features\/auth\/(claims\.ts|index\.ts))$/,
  },
];
for (const f of files) {
  if (isTest(f.rel)) continue;
  for (const rule of WIRING_RULES) {
    if (rule.allowed.test(`/${f.rel}`)) continue;
    const callRe = new RegExp(`(?<!function\\s)\\b${rule.fn}\\s*\\(`, 'g');
    for (const m of f.text.matchAll(callRe)) {
      violations.push({
        file: f.rel,
        line: lineOf(f.text, m.index),
        rule: 'R4 composition-root',
        detail: `${rule.fn}() 호출은 app.ts(composition root)에서만 — feature 간 순환 방지`,
      });
    }
  }
}

// ── R5: feature 스캐폴드 완결성 (index.ts 필수) ──
const featureDirs = new Set<string>();
for (const f of files) {
  const m = f.rel.match(/^(apps\/[^/]+\/src\/features\/[^/]+)\//);
  if (m) featureDirs.add(m[1]!);
}
for (const dir of featureDirs) {
  if (!(await Bun.file(`${REPO_ROOT}/${dir}/index.ts`).exists())) {
    violations.push({
      file: dir,
      line: 0,
      rule: 'R5 public-api',
      detail: 'index.ts(공개 API) 없음 — 크로스 feature 접근 규약이 성립 안 함',
    });
  }
}

// ── 판정 ──
if (violations.length > 0) {
  for (const v of violations.sort((a, b) => a.file.localeCompare(b.file))) {
    console.error(`✘ [${v.rule}] ${v.file}:${v.line} — ${v.detail}`);
  }
  console.error(`\n${violations.length}건 위반. 규칙: ARCHITECTURE.md`);
  process.exit(1);
}
console.log(`✔ arch-check ok (${files.length} files, tables: ${tableOwner.size})`);
