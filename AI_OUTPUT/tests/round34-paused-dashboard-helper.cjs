'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const harnessPath = path.resolve(__dirname, 'chrome-e2e-runtime.cjs');
const { assertPausedDashboard } = require(harnessPath);

assert.equal(typeof assertPausedDashboard, 'function');

function fakeCdp(value) {
  return {
    async send(method) {
      assert.equal(method, 'Runtime.evaluate');
      return {
        result: {
          value
        }
      };
    }
  };
}

(async () => {
  const page = { sessionId: 'fixture-session' };
  const result = await assertPausedDashboard(
    fakeCdp({
      pill: 'Paused',
      status: 'PAUSED — RUNTIME_CONTINUATION_STATE_INCONSISTENT\nRuntime: Paused'
    }),
    page,
    /RUNTIME_CONTINUATION_STATE_INCONSISTENT/,
    { timeoutMs: 50, intervalMs: 1 }
  );

  assert.equal(result.pill, 'Paused');
  assert.match(result.status, /Runtime:\s*Paused/);

  let rejected = false;
  try {
    await assertPausedDashboard(
      fakeCdp({
        pill: 'Running',
        status: 'Running — Relay\nRuntime: Awaiting provider response'
      }),
      page,
      /expected reason/,
      { timeoutMs: 10, intervalMs: 1 }
    );
  } catch (error) {
    rejected = true;
    assert.match(error.message, /Poll timeout/);
  }
  assert.equal(rejected, true, 'helper must reject misleading Running UI');

  console.log('round34-paused-dashboard-helper: PASS');
})().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
