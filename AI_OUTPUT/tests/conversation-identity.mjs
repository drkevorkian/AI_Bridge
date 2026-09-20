import assert from "node:assert/strict";
import { deriveConversationIdentity, classifyIdentityTransition, createDispatchCache } from "../dom_resilience/conversation-identity.js";

const oldId = deriveConversationIdentity("https://chatgpt.com/c/abc123?utm=x#frag");
assert.deepEqual(oldId, { provider:"chatgpt", kind:"conversation", routeClass:"conversation", threadKey:"abc123", provisional:false, writable:true });
const same = deriveConversationIdentity("https://chatgpt.com/c/abc123?different=yes");
assert.equal(classifyIdentityTransition(oldId, same), "IDENTITY_UNCHANGED");
const surface = deriveConversationIdentity("https://chatgpt.com/");
assert.equal(classifyIdentityTransition(oldId, surface), "NEW_CHAT_SURFACE");
const fresh = deriveConversationIdentity("https://chatgpt.com/c/new456");
assert.equal(classifyIdentityTransition(oldId, fresh), "NEW_CONVERSATION_CONFIRMED");
const share = deriveConversationIdentity("https://grok.com/share/share123");
assert.equal(share.writable, false);
assert.equal(share.kind, "share");

const cache = createDispatchCache({ maxEntries: 2 });
assert.equal(cache.accept({ dispatchId:"d1", identityAtAcceptance:surface, generation:1, result:{ok:true} }).duplicate, false);
assert.equal(cache.accept({ dispatchId:"d1", identityAtAcceptance:surface, generation:1, result:{ok:true} }).duplicate, true);
assert.equal(cache.accept({ dispatchId:"d1", identityAtAcceptance:fresh, generation:1, result:{ok:true} }).reason, "dispatch-context-mismatch");
assert.equal(cache.accept({ dispatchId:"d1", identityAtAcceptance:fresh, generation:1, result:{ok:true}, expectedTransition:true }).ok, true);
console.log("conversation-identity: PASS");
