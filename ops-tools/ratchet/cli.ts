// 품질 라쳇 — 후퇴하면 exit 1, 개선하면 `update`로 베이스라인을 조인다.
//   bun ops-tools/ratchet/cli.ts check                  # CI 게이트
//   bun ops-tools/ratchet/cli.ts update                 # 개선분 베이스라인 반영 (커밋 필요)
//   bun ops-tools/ratchet/cli.ts guard-baseline <old>   # baseline 개악(완화) 감지 — CI가
//                                                       # base 브랜치의 baseline과 비교
import { measureAnyCount } from './metrics/any-count';
import { measureCoverage } from './metrics/coverage';
import { measureProdDeps } from './metrics/deps-count';
import { measureKnipCount } from './metrics/knip-count';
import { measureSuppressionCount } from './metrics/suppression-count';

type Baseline = {
  coveragePct: number; // ⬆만 허용
  anyCount: number; // ⬇만 허용
  knipIssues: number; // ⬇만 허용
  suppressionCount: number; // ⬇만 허용 — 억제 주석·포커스/스킵 테스트 (정의: metrics/suppression-count.ts)
  prodDeps: number; // 초과 시 경고만
};

const DOWN_ONLY = ['anyCount', 'knipIssues', 'suppressionCount'] as const;

const REPO_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const BASELINE_PATH = `${REPO_ROOT}/ops-tools/ratchet/baseline.json`;
// 커버리지는 소수점 노이즈가 있어서 이만큼의 하락은 후퇴로 안 본다.
const COVERAGE_TOLERANCE = 0.3;

/** old 대비 new가 "완화"된 지표 목록 (guard-baseline·check 공용) */
function findLoosening(oldB: Partial<Baseline>, newB: Baseline): string[] {
  const loosened: string[] = [];
  if (
    oldB.coveragePct !== undefined &&
    newB.coveragePct < oldB.coveragePct - COVERAGE_TOLERANCE
  ) {
    loosened.push(`coveragePct ${oldB.coveragePct}% → ${newB.coveragePct}%`);
  }
  for (const key of DOWN_ONLY) {
    const prev = oldB[key];
    if (prev !== undefined && newB[key] > prev) {
      loosened.push(`${key} ${prev} → ${newB[key]}`);
    }
  }
  return loosened;
}

async function isDbUp(): Promise<boolean> {
  const url = process.env.DATABASE_URL ?? 'postgres://p0:p0@localhost:5432/p0';
  let hostname = 'localhost';
  let port = 5432;
  try {
    const u = new URL(url);
    hostname = u.hostname || hostname;
    port = Number(u.port) || 5432;
  } catch {
    // 기본값 사용
  }
  try {
    const socket = await Bun.connect({
      hostname,
      port,
      socket: { data() {}, open() {}, error() {} },
    });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

async function measure(): Promise<Baseline> {
  const [coveragePct, anyCount, knipIssues, suppressionCount, prodDeps] =
    await Promise.all([
      measureCoverage(REPO_ROOT),
      measureAnyCount(REPO_ROOT),
      measureKnipCount(REPO_ROOT),
      measureSuppressionCount(REPO_ROOT),
      measureProdDeps(REPO_ROOT),
    ]);
  return { coveragePct, anyCount, knipIssues, suppressionCount, prodDeps };
}

const command = process.argv[2];

// ── guard-baseline: 측정 없이 baseline 파일끼리 비교 (개악 방지 게이트) ──
if (command === 'guard-baseline') {
  const oldPath = process.argv[3];
  if (!oldPath) {
    console.error('usage: cli.ts guard-baseline <old-baseline.json>');
    process.exit(2);
  }
  const oldB = (await Bun.file(oldPath).json()) as Partial<Baseline>;
  const newB = (await Bun.file(BASELINE_PATH).json()) as Baseline;
  const loosened = findLoosening(oldB, newB);
  if (loosened.length > 0) {
    for (const l of loosened) console.error(`✘ baseline 완화 감지: ${l}`);
    console.error(
      '\nbaseline은 조이는 방향만 허용된다. 정당한 완화(측정방식 변경 등)라면' +
        ' PR 제목에 [ratchet-loosen] 태그 + 본문에 사유를 남겨라.',
    );
    process.exit(1);
  }
  console.log('✔ baseline 개악 없음');
  process.exit(0);
}

if (command !== 'check' && command !== 'update') {
  console.error('usage: cli.ts <check|update|guard-baseline>');
  process.exit(2);
}

// 공허-green 방지: DB 다운이면 통합테스트가 skip돼 커버리지가 왜곡된다.
if (!(await isDbUp())) {
  console.warn(
    '⚠ DB 미기동 — 통합테스트 skip 상태로 측정된다. 이 수치로 baseline을 만지지 마라' +
      ' (docker compose up -d postgres 후 다시).',
  );
}

const current = await measure();

if (command === 'update') {
  await Bun.write(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log('✔ baseline.json 갱신:', current);
  process.exit(0);
}

const baseline = (await Bun.file(BASELINE_PATH).json()) as Baseline;
const failures = findLoosening(baseline, current);
const improvements: string[] = [];
if (current.coveragePct > baseline.coveragePct + COVERAGE_TOLERANCE) {
  improvements.push(`coveragePct ${baseline.coveragePct}% → ${current.coveragePct}%`);
}
for (const key of DOWN_ONLY) {
  if (current[key] < baseline[key]) {
    improvements.push(`${key} ${baseline[key]} → ${current[key]}`);
  }
}

console.log('현재:', current);
console.log('기준:', baseline);
if (current.prodDeps > baseline.prodDeps) {
  console.warn(
    `⚠ prod 의존성 ${baseline.prodDeps} → ${current.prodDeps} — PR 설명에 추가 사유를 남겨라`,
  );
}
for (const i of improvements) {
  console.log(`↑ 개선: ${i} — \`bun run ratchet:update\`로 조여서 커밋해라`);
}
if (failures.length > 0) {
  for (const f of failures) console.error(`✘ 라쳇 후퇴: ${f}`);
  process.exit(1);
}
console.log('✔ ratchet ok');
