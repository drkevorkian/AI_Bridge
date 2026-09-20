import assert from 'node:assert/strict';
import {summarizeProviderHealth,HEALTH_CONTEXT,PROVIDER_STATUS,AUTHORITY_STATUS} from '../integration/provider-health-reducer.js';

const caps={
  composer:{state:'PASS'},
  send:{state:'PASS'},
  response:{state:'PASS'},
  conversation_identity:{state:'PASS'},
  limit_state:{state:'PASS'},
  new_chat:{state:'UNSUPPORTED'},
  upload:{state:'UNSUPPORTED'},
  stop:{state:'PASS'}
};

for(const readiness of [
  undefined,
  AUTHORITY_STATUS.UNSPECIFIED,
  AUTHORITY_STATUS.UNKNOWN,
  AUTHORITY_STATUS.LISTENER_CONNECTED,
  AUTHORITY_STATUS.DISCONNECTED
]){
  const health=summarizeProviderHealth({
    provider:'chatgpt',
    bridgeConnected:true,
    documentReadiness:readiness,
    capabilities:caps,
    context:HEALTH_CONTEXT.RELAY
  });
  assert.equal(health.runnable,false);
  assert.equal(health.status,PROVIDER_STATUS.DEGRADED);
  assert.notEqual(health.status,PROVIDER_STATUS.HEALTHY);
}

let health=summarizeProviderHealth({
  provider:'chatgpt',
  bridgeConnected:true,
  documentReadiness:AUTHORITY_STATUS.REGISTERING,
  capabilities:caps,
  context:HEALTH_CONTEXT.RELAY
});
assert.equal(health.status,PROVIDER_STATUS.REGISTERING);
assert.equal(health.runnable,false);

health=summarizeProviderHealth({
  provider:'chatgpt',
  bridgeConnected:true,
  documentReadiness:AUTHORITY_STATUS.VERIFIED,
  capabilities:caps,
  context:HEALTH_CONTEXT.RELAY
});
assert.equal(health.runnable,true);
assert.equal(health.status,PROVIDER_STATUS.DEGRADED);

health=summarizeProviderHealth({
  provider:'chatgpt',
  bridgeConnected:true,
  documentReadiness:AUTHORITY_STATUS.VERIFIED,
  capabilities:caps,
  context:HEALTH_CONTEXT.ROLLOVER
});
assert.equal(health.runnable,false);
assert.equal(health.status,PROVIDER_STATUS.LIMITED);

console.log('round25-provider-health-failclosed: PASS');
