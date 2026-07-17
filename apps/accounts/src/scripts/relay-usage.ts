// usage → Stripe Billing Meter 릴레이 배치 — cron에서 주기 실행.
// ⚠️ Stripe 멱등 윈도우(24h) 안에 재시도가 돌도록 주기는 ≤ 몇 시간으로. 그보다 뜸하면
//    격리(quarantine)가 늘고 미청구 유실 위험 → failed/quarantine 시 non-zero exit로 알림.
import { relayUsage } from '../features/usage';

const result = await relayUsage();
console.log('[relay-usage]', JSON.stringify(result));
// 완전 실패(Stripe 다운·키 오류)나 격리 발생을 cron/알림이 감지하도록 non-zero exit.
process.exit(result.failed > 0 || result.quarantined > 0 ? 1 : 0);
