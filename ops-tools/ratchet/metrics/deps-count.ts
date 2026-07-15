// prod 의존성 개수 — 늘어나면 경고만 (fail 아님, 정당화 요구용).
import { Glob } from 'bun';

export async function measureProdDeps(repoRoot: string): Promise<number> {
  const glob = new Glob('{apps,packages}/*/package.json');
  const names = new Set<string>();
  for await (const rel of glob.scan({ cwd: repoRoot })) {
    if (rel.includes('node_modules/')) continue;
    const pkg = (await Bun.file(`${repoRoot}/${rel}`).json()) as {
      dependencies?: Record<string, string>;
    };
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!dep.startsWith('@p0/')) names.add(dep);
    }
  }
  return names.size;
}
