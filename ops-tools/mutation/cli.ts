// mutation smoke — "커버리지 90%"가 아니라 "버그를 심으면 테스트가 죽는가"를 잰다.
// Stryker가 bun 미지원이라 직접 구현. domain/(순수 로직)만 대상 — 빠르고 결정적.
//
//   bun ops-tools/mutation/cli.ts check    # kill rate < 플로어 → exit 1 (CI 게이트)
//   bun ops-tools/mutation/cli.ts update   # 현재 kill rate를 플로어로 (조이기, 커밋 필요)
//
// 원리: domain 파일에 결정적 변이(===↔!==, &&→||, >=→>, <=→<)를 하나씩 심고
// 그 feature의 테스트를 돌린다. 테스트가 죽으면 killed, 통과하면 survived.
// survived = "이 버그는 아무 테스트도 못 잡는다"는 뜻이다.
import { $, Glob } from 'bun';

const REPO_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const THRESHOLD_PATH = `${REPO_ROOT}/ops-tools/mutation/threshold.json`;
// 파일×뮤테이터당 상한 — 실행시간 예산 (전수는 도메인 커지면 재조정)
const MAX_PER_FILE_PER_MUTATOR = 6;
// kill rate는 변이 모수가 바뀌면 ±1~2%p 출렁인다 — 그 이하 하락은 후퇴로 안 봄
const TOLERANCE_PCT = 1;

type Threshold = { minKillRatePct: number; mutants: number };

const MUTATORS = [
  { name: '===→!==', re: /===/g, to: '!==' },
  { name: '!==→===', re: /!==/g, to: '===' },
  { name: '&&→||', re: /&&/g, to: '||' },
  { name: '>=→>', re: />=/g, to: '>' },
  { name: '<=→<', re: /<=/g, to: '<' },
] as const;

function replaceNth(
  src: string,
  re: RegExp,
  nth: number,
  to: string,
): { out: string; line: number } | null {
  const r = new RegExp(re.source, 'g');
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = r.exec(src)) !== null) {
    if (i === nth) {
      const out = src.slice(0, m.index) + to + src.slice(m.index + m[0].length);
      const line = src.slice(0, m.index).split('\n').length;
      return { out, line };
    }
    i++;
  }
  return null;
}

type DomainFile = { abs: string; rel: string; appDir: string; featureRel: string };

async function findDomainFiles(): Promise<DomainFile[]> {
  const glob = new Glob('apps/*/src/features/*/domain/**/*.ts');
  const files: DomainFile[] = [];
  for await (const rel of glob.scan({ cwd: REPO_ROOT })) {
    if (rel.includes('node_modules/') || rel.includes('__tests__')) continue;
    if (rel.endsWith('.test.ts')) continue; // 콜로케이트 테스트 — 변이 대상 아님 (kill rate 허위 부풀림 방지)
    const parts = rel.split('/'); // apps/<app>/src/features/<f>/domain/...
    files.push({
      abs: `${REPO_ROOT}/${rel}`,
      rel,
      appDir: `${REPO_ROOT}/${parts[0]}/${parts[1]}`,
      featureRel: `${parts[2]}/${parts[3]}/${parts[4]}`,
    });
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function featureTestsPass(appDir: string, featureRel: string): Promise<boolean> {
  const res = await $`bun test ${featureRel}`.cwd(appDir).quiet().nothrow();
  return res.exitCode === 0;
}

const command = process.argv[2];
if (command !== 'check' && command !== 'update') {
  console.error('usage: cli.ts <check|update>');
  process.exit(2);
}

const files = await findDomainFiles();
let total = 0;
let killed = 0;
const survivors: string[] = [];
const validatedFeatures = new Set<string>();

for (const file of files) {
  const featureKey = `${file.appDir}:${file.featureRel}`;
  // 변이 전 원상태에서 테스트가 통과하는지 1회 확인 (더러운 상태에서 측정 방지)
  if (!validatedFeatures.has(featureKey)) {
    if (!(await featureTestsPass(file.appDir, file.featureRel))) {
      console.error(`✘ 사전실패: ${file.featureRel} 테스트가 변이 전부터 빨강 — 먼저 고쳐라`);
      process.exit(2);
    }
    validatedFeatures.add(featureKey);
  }

  const original = await Bun.file(file.abs).text();
  try {
    for (const mutator of MUTATORS) {
      for (let nth = 0; nth < MAX_PER_FILE_PER_MUTATOR; nth++) {
        const mutated = replaceNth(original, mutator.re, nth, mutator.to);
        if (!mutated) break;
        total++;
        await Bun.write(file.abs, mutated.out);
        const res = await $`bun test ${file.featureRel}`
          .cwd(file.appDir)
          .quiet()
          .nothrow();
        if (res.exitCode !== 0) {
          killed++;
        } else {
          survivors.push(`${file.rel}:${mutated.line} (${mutator.name})`);
        }
      }
    }
  } finally {
    await Bun.write(file.abs, original); // 어떤 경우에도 원복
  }
}

const ratePct = total === 0 ? 100 : Math.round((killed / total) * 1000) / 10;
console.log(`mutants: ${total}, killed: ${killed}, kill rate: ${ratePct}%`);
for (const s of survivors) console.log(`  🧟 survived: ${s}`);

if (command === 'update') {
  const t: Threshold = { minKillRatePct: ratePct, mutants: total };
  await Bun.write(THRESHOLD_PATH, `${JSON.stringify(t, null, 2)}\n`);
  console.log('✔ threshold.json 갱신:', t);
  process.exit(0);
}

const threshold = (await Bun.file(THRESHOLD_PATH).json()) as Threshold;
if (ratePct < threshold.minKillRatePct - TOLERANCE_PCT) {
  console.error(
    `✘ mutation 후퇴: kill rate ${threshold.minKillRatePct}% → ${ratePct}% — ` +
      'survived 변이를 잡는 테스트를 추가해라',
  );
  process.exit(1);
}
if (ratePct > threshold.minKillRatePct + TOLERANCE_PCT) {
  console.log(
    `↑ 개선: ${threshold.minKillRatePct}% → ${ratePct}% — \`bun ops-tools/mutation/cli.ts update\`로 조여라`,
  );
}
console.log('✔ mutation ok');
