// 테스트 라인 커버리지 (%) — lcov 파싱. 방향: ⬆만 허용.
// apps/* 중 `bun test` 스크립트를 가진 모든 앱을 합산 (앱 추가 시 자동 포함).
import { $, Glob } from 'bun';

export async function measureCoverage(repoRoot: string): Promise<number> {
  const glob = new Glob('apps/*/package.json');
  let found = 0;
  let hit = 0;

  for await (const rel of glob.scan({ cwd: repoRoot })) {
    if (rel.includes('node_modules/')) continue;
    const pkg = (await Bun.file(`${repoRoot}/${rel}`).json()) as {
      scripts?: Record<string, string>;
    };
    if (!pkg.scripts?.test?.includes('bun test')) continue;

    const appDir = `${repoRoot}/${rel.replace(/\/package\.json$/, '')}`;
    const lcovFile = `${appDir}/coverage/lcov.info`;

    // CI는 테스트를 이미 돌렸으므로 기존 lcov 재사용 (이중 실행 방지)
    if (
      process.env.RATCHET_REUSE_LCOV !== '1' ||
      !(await Bun.file(lcovFile).exists())
    ) {
      await $`bun test --coverage --coverage-reporter=lcov`.cwd(appDir).quiet();
    }

    const lcov = await Bun.file(lcovFile).text();
    for (const line of lcov.split('\n')) {
      if (line.startsWith('LF:')) found += Number(line.slice(3));
      else if (line.startsWith('LH:')) hit += Number(line.slice(3));
    }
  }

  if (found === 0) return 0;
  return Math.round((hit / found) * 10000) / 100;
}
