// bun test 프리로드.
// 1) composition root(app.ts)를 import해 늦은바인딩 훅(시트/org삭제/유저삭제/claims)을
//    모든 테스트 프로세스에 결정적으로 배선한다 — auth를 직접 import하는 테스트도
//    실제 핸들러를 타게 하고(A1/A2), fail-closed 기본값(throw)을 안전하게 만든다.
// 2) CI에서는 DB가 반드시 떠 있어야 한다 — 없으면 스위트 전체 하드 실패(보안 통합테스트
//    가 skip으로 조용히 증발 방지).
import './src/app';
import { env } from './src/lib/env';

if (env.CI) {
  const { db } = await import('./src/lib/db');
  try {
    await db.execute('select 1' as never);
  } catch (e) {
    throw new Error(
      `[test-preload] CI requires a reachable database but connection failed: ${String(e)}. ` +
        'Refusing to run — security integration tests would otherwise silently skip.',
    );
  }
}
