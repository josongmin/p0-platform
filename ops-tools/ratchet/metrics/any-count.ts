// `any` 사용 수 — 타입 안전성 라쳇. 방향: ⬇만 허용.
// 외부 도구 없이 순수 Bun (CI 러너에 rg 유무 무관하게 결정적).
import { Glob } from 'bun';

const ANY_PATTERN = /(:\s*any\b|\bas\s+any\b|<any[,>\s]|\bany\[\])/g;

export async function measureAnyCount(repoRoot: string): Promise<number> {
  const glob = new Glob('{apps,packages,ops-tools}/*/**/*.ts');
  let count = 0;
  for await (const rel of glob.scan({ cwd: repoRoot })) {
    if (rel.includes('node_modules/') || rel.includes('/coverage/')) continue;
    // 생성 파일은 우리 라쳇 대상 아님 (auth:generate 산출물)
    if (rel.endsWith('packages/db/src/schema/auth.ts')) continue;
    const text = await Bun.file(`${repoRoot}/${rel}`).text();
    count += [...text.matchAll(ANY_PATTERN)].length;
  }
  return count;
}
