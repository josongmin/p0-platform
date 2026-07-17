// 억제/우회 수 — 검사를 끄는 모든 탈출구의 총량. 방향: ⬇만 허용.
// 대상: ts-ignore/ts-expect-error 계열 주석(타입 검사 끄기),
// eslint-disable 계열(lint 끄기), .only( 포커스 테스트(나머지 스위트가 조용히 안 돎),
// .skip( 정적 skip — 조건부 .skipIf( 는 매치되지 않음 (DB-gated 통합테스트는 허용).
import { Glob } from 'bun';

const PATTERNS = [
  /@ts-ignore/g,
  /@ts-expect-error/g,
  /eslint-disable/g,
  /\.only\(/g,
  /\.skip\(/g,
];

const SELF = 'ops-tools/ratchet/metrics/suppression-count.ts';

export async function measureSuppressionCount(repoRoot: string): Promise<number> {
  const glob = new Glob('{apps,packages,ops-tools}/*/**/*.ts');
  let count = 0;
  for await (const rel of glob.scan({ cwd: repoRoot })) {
    if (rel.includes('node_modules/') || rel.includes('/coverage/')) continue;
    if (rel.endsWith('packages/db/src/schema/auth.ts')) continue; // 생성물
    if (rel === SELF) continue; // 패턴 정의 자체
    const text = await Bun.file(`${repoRoot}/${rel}`).text();
    for (const pattern of PATTERNS) {
      count += [...text.matchAll(pattern)].length;
    }
  }
  return count;
}
