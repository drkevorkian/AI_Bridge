import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classifyThreadLimit } = require('../thread_rollover/provider-limit-signatures.js');

const hard = classifyThreadLimit({
  provider: 'chatgpt',
  regions: [{
    kind: 'system-banner',
    visible: true,
    text: "You've reached the maximum length for this conversation, but you can keep talking by starting a new chat."
  }],
  composer: { present: true, disabled: true }
});
assert.equal(hard.state, 'HARD_THREAD_LIMIT');
assert.equal(hard.automaticRollover, true);

const poisoned = classifyThreadLimit({
  provider: 'chatgpt',
  regions: [{
    kind: 'assistant-response',
    visible: true,
    text: "You've reached the maximum length for this conversation"
  }]
});
assert.equal(poisoned.state, 'UNTRUSTED_TEXT_ONLY');
assert.equal(poisoned.automaticRollover, false);

const quota = classifyThreadLimit({
  provider: 'chatgpt',
  regions: [{
    kind: 'provider-notice',
    visible: true,
    text: 'You have reached your usage limit. Try again in 2 hours.'
  }]
});
assert.equal(quota.state, 'NON_THREAD_LIMIT');
assert.equal(quota.automaticRollover, false);

const grok = classifyThreadLimit({
  provider: 'grok',
  regions: [{
    kind: 'provider-notice',
    visible: true,
    text: 'Conversation is getting long'
  }]
});
assert.equal(grok.automaticRollover, false);

const unknown = classifyThreadLimit({
  provider: 'evil-provider',
  regions: []
});
assert.equal(unknown.state, 'UNKNOWN_PROVIDER');

console.log('provider-limit-signatures: ok');
