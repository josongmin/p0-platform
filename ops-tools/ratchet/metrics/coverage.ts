// 테스트 라인 커버리지 (%) — lcov 파싱. 방향: ⬆만 허용.
import { $ } from 'bun';

const LCOV_PATH = 'apps/accounts/coverage/lcov.info';

export async function measureCoverage(repoRoot: string): Promise<number> {
  const lcovFile = `${repoRoot}/${LCOV_PATH}`;

  // CI는 테스트를 이미 돌렸으므로 기존 lcov 재사용 (이중 실행 방지)
  if (process.env.RATCHET_REUSE_LCOV !== '1' || !(await Bun.file(lcovFile).exists())) {
    await $`bun test --coverage --coverage-reporter=lcov`
      .cwd(`${repoRoot}/apps/accounts`)
      .quiet();
  }

  const lcov = await Bun.file(lcovFile).text();
  let found = 0;
  let hit = 0;
  for (const line of lcov.split('\n')) {
    if (line.startsWith('LF:')) found += Number(line.slice(3));
    else if (line.startsWith('LH:')) hit += Number(line.slice(3));
  }
  if (found === 0) return 0;
  return Math.round((hit / found) * 10000) / 100;
}
