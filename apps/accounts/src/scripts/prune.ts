// 리텐션 프루닝 실행 스크립트 — cron에서 `bun run src/scripts/prune.ts` 호출.
// 부분 실패 시 non-zero exit → cron이 실패를 감지할 수 있게.
import { runRetentionPrune } from '../lib/maintenance';

const result = await runRetentionPrune();
console.log('[prune]', JSON.stringify(result));
process.exit(result.anyFailed ? 1 : 0);
