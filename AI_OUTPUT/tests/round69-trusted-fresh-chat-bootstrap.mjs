import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const background=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");

const pendingStart=background.indexOf("function reviewPendingSurfaceDispatchForSide(side)");
const bootstrapStart=background.indexOf("async function reviewInitialSurfaceBootstrapAllowed(side, authority)",pendingStart);
const registerStart=background.indexOf("async function reviewRegisterSideAuthority(side)",bootstrapStart);
assert.ok(pendingStart>=0&&bootstrapStart>pendingStart&&registerStart>bootstrapStart,
  "trusted fresh-chat bootstrap helpers missing");

const pending=background.slice(pendingStart,bootstrapStart);
assert.doesNotMatch(pending,/DISPATCH_STATUS\.CREATED/,
  "unexecuted CREATED dispatches must not authorize a surface-to-conversation promotion");

const bootstrap=background.slice(bootstrapStart,registerStart);
for(const token of [
  "!state.sessionActive",
  'authority.identity?.kind !== "surface"',
  "authority.identity?.provisional !== true",
  "authority.identity?.writable !== true",
  "Number(authority.tabId) !== Number(tabForSide(normalizedSide))",
  'activeRollover && !["COMPLETE", "FAILED"].includes(activeRollover.phase)',
  'String(state.lastSentBySide?.[normalizedSide] || "").trim()',
  'entry?.type === "response"',
  'record.status !== DISPATCH_STATUS.FAILED',
  'record.purpose !== "INITIAL"',
  "record.acceptedAt != null",
  "reviewAuthorityEpochs[normalizedSide]",
  "reviewSameIdentity(durable.identity, authority.identity)",
  "reviewCanonicalRolloverFreshUrl(authority.provider)",
  'String(tab?.url || "") === canonical'
]) assert.ok(bootstrap.includes(token),"bootstrap fail-closed contract missing "+token);

const registerEnd=background.indexOf("async function reviewApplyRegisteredRolloverAuthority",registerStart);
assert.ok(registerEnd>registerStart,"authority registration boundary missing");
const register=background.slice(registerStart,registerEnd);
for(const token of [
  "const pendingSurfaceDispatch = reviewPendingSurfaceDispatchForSide(side);",
  "const dispatchSurfacePromotion = Boolean(",
  'prior.identity?.kind === "surface"',
  "prior.identity?.provisional === true",
  'expectedIdentity.kind === "conversation"',
  "expectedIdentity.provisional === false",
  "Number(prior.generationEpoch) === Number(pendingSurfaceDispatch.generationEpoch)",
  "reviewSameIdentity(pendingSurfaceDispatch.conversationIdentity, prior.identity)",
  "equivalent || rolloverSurfacePromotion || dispatchSurfacePromotion"
]) assert.ok(register.includes(token),"surface-to-conversation promotion contract missing "+token);

const sendStart=background.indexOf("async function sendToSide(side, text");
const sendEnd=background.indexOf("async function openDashboard()",sendStart);
assert.ok(sendStart>=0&&sendEnd>sendStart,"sendToSide boundary missing");
const send=background.slice(sendStart,sendEnd);
for(const token of [
  "const confirmedConversation = Boolean(",
  "const initialSurfaceBootstrap = confirmedConversation",
  "await reviewInitialSurfaceBootstrapAllowed(side, authority)",
  "if (!confirmedConversation && !initialSurfaceBootstrap)",
  'purpose: initialSurfaceBootstrap ? "INITIAL" : "RELAY"'
]) assert.ok(send.includes(token),"first-dispatch surface bootstrap missing "+token);
assert.doesNotMatch(send,/Blank\/new-chat surfaces remain fail-closed until trusted New Chat allocation is implemented/,
  "obsolete blanket provisional-surface rejection must be removed");

const routeMarker='if (msg.type === "AI_BRIDGE_DOCUMENT_ROUTE_CHANGED")';
const routeStart=background.indexOf(routeMarker);
const routeEnd=background.indexOf('if (msg.type === "AI_BRIDGE_PROVIDER_EVENT")',routeStart);
assert.ok(routeStart>=0&&routeEnd>routeStart,"route-change authority handler missing");
const route=background.slice(routeStart,routeEnd);
for(const token of [
  "reviewInvalidateAuthorityForTab(changedTabId)",
  "const pendingSurfaceDispatch = reviewPendingSurfaceDispatchForSide(changedSide);",
  '(tx && !["COMPLETE", "FAILED"].includes(tx.phase)) ||',
  "pendingSurfaceDispatch",
  "reviewRegisterSideAuthority(changedSide)"
]) assert.ok(route.includes(token),"route promotion recovery contract missing "+token);

console.log("round69-trusted-fresh-chat-bootstrap: PASS");
