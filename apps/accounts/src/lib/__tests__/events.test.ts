// 이벤트 버스 — 한 핸들러의 실패가 프로세스를 죽이거나 다른 핸들러를 막지 않아야 함.
import { describe, expect, test } from 'bun:test';
import { bus } from '../events';

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('bus — 격리된 핸들러 실패', () => {
  test('던지는 핸들러가 있어도 emit은 throw하지 않고 다른 핸들러는 실행된다', async () => {
    let sideEffect = false;
    bus.on('usage.recorded', () => {
      throw new Error('boom (sync)');
    });
    bus.on('usage.recorded', () => {
      sideEffect = true;
    });

    expect(() =>
      bus.emit('usage.recorded', {
        orgId: 'o',
        metric: 'ai_tokens',
        quantity: 1,
        at: new Date().toISOString(),
        idempotencyKey: 'k'.repeat(10),
      }),
    ).not.toThrow();

    await tick();
    expect(sideEffect).toBe(true);
  });

  test('거부(reject)하는 async 핸들러도 unhandled rejection 없이 삼켜진다', async () => {
    let rejected = false;
    process.once('unhandledRejection', () => {
      rejected = true;
    });
    bus.on('usage.recorded', async () => {
      await Promise.resolve();
      throw new Error('boom (async)');
    });
    bus.emit('usage.recorded', {
      orgId: 'o',
      metric: 'scans',
      quantity: 1,
      at: new Date().toISOString(),
      idempotencyKey: 'k'.repeat(10),
    });
    await tick();
    expect(rejected).toBe(false);
  });
});
