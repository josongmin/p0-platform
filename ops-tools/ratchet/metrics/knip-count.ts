// knip 이슈 수 (미사용 export·파일·의존성) — 죽은 코드 라쳇. 방향: ⬇만 허용.
import { $ } from 'bun';

type KnipReport = {
  files: string[];
  issues: Array<Record<string, unknown[]>>;
};

export async function measureKnipCount(repoRoot: string): Promise<number> {
  const result = await $`bunx knip --no-exit-code --reporter json`
    .cwd(repoRoot)
    .quiet();
  const report = JSON.parse(result.stdout.toString()) as KnipReport;

  let count = report.files.length;
  for (const issue of report.issues) {
    for (const value of Object.values(issue)) {
      if (Array.isArray(value)) count += value.length;
    }
  }
  return count;
}
