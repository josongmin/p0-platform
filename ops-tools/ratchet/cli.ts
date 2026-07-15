// 품질 라쳇 — 후퇴하면 exit 1, 개선하면 `update`로 베이스라인을 조인다.
//   bun ops-tools/ratchet/cli.ts check    # CI 게이트
//   bun ops-tools/ratchet/cli.ts update   # 개선분 베이스라인 반영 (커밋 필요)
import { measureAnyCount } from './metrics/any-count';
import { measureCoverage } from './metrics/coverage';
import { measureProdDeps } from './metrics/deps-count';
import { measureKnipCount } from './metrics/knip-count';

type Baseline = {
  coveragePct: number; // ⬆만 허용
  anyCount: number; // ⬇만 허용
  knipIssues: number; // ⬇만 허용
  prodDeps: number; // 초과 시 경고만
};

const REPO_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const BASELINE_PATH = `${REPO_ROOT}/ops-tools/ratchet/baseline.json`;
// 커버리지는 소수점 노이즈가 있어서 이만큼의 하락은 후퇴로 안 본다.
const COVERAGE_TOLERANCE = 0.3;

async function measure(): Promise<Baseline> {
  const [coveragePct, anyCount, knipIssues, prodDeps] = await Promise.all([
    measureCoverage(REPO_ROOT),
    measureAnyCount(REPO_ROOT),
    measureKnipCount(REPO_ROOT),
    measureProdDeps(REPO_ROOT),
  ]);
  return { coveragePct, anyCount, knipIssues, prodDeps };
}

function report(current: Baseline, baseline: Baseline): { failures: string[]; improvements: string[]; warnings: string[] } {
  const failures: string[] = [];
  const improvements: string[] = [];
  const warnings: string[] = [];

  if (current.coveragePct < baseline.coveragePct - COVERAGE_TOLERANCE) {
    failures.push(`coverage ${baseline.coveragePct}% → ${current.coveragePct}% (하락 금지)`);
  } else if (current.coveragePct > baseline.coveragePct + COVERAGE_TOLERANCE) {
    improvements.push(`coverage ${baseline.coveragePct}% → ${current.coveragePct}%`);
  }

  for (const key of ['anyCount', 'knipIssues'] as const) {
    if (current[key] > baseline[key]) {
      failures.push(`${key} ${baseline[key]} → ${current[key]} (증가 금지)`);
    } else if (current[key] < baseline[key]) {
      improvements.push(`${key} ${baseline[key]} → ${current[key]}`);
    }
  }

  if (current.prodDeps > baseline.prodDeps) {
    warnings.push(
      `prod 의존성 ${baseline.prodDeps} → ${current.prodDeps} — PR 설명에 추가 사유를 남겨라`,
    );
  }

  return { failures, improvements, warnings };
}

const command = process.argv[2];
const current = await measure();

if (command === 'update') {
  await Bun.write(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log('✔ baseline.json 갱신:', current);
  process.exit(0);
}

if (command !== 'check') {
  console.error('usage: cli.ts <check|update>');
  process.exit(2);
}

const baseline = (await Bun.file(BASELINE_PATH).json()) as Baseline;
const { failures, improvements, warnings } = report(current, baseline);

console.log('현재:', current);
console.log('기준:', baseline);
for (const w of warnings) console.warn(`⚠ ${w}`);
for (const i of improvements) {
  console.log(`↑ 개선: ${i} — \`bun run ratchet:update\`로 조여서 커밋해라`);
}
if (failures.length > 0) {
  for (const f of failures) console.error(`✘ 라쳇 후퇴: ${f}`);
  process.exit(1);
}
console.log('✔ ratchet ok');
