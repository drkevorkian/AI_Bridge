/**
 * selector-ranking.js
 * AI C / AI_OUTPUT review module.
 *
 * Ranks provider selector contracts and scores probe results.
 * Does not touch the live page. Callers pass a query function so tests
 * can inject fixtures without a browser.
 *
 * Rank bands (locked with AI A):
 *   EXACT_SEMANTIC   → PASS candidate
 *   ACCESSIBLE_EXACT → PASS candidate
 *   STRUCTURAL       → DEGRADED candidate
 *   BROAD_GENERIC    → telemetry only, never authority
 */

export const RANK = Object.freeze({
  EXACT_SEMANTIC: 0,
  ACCESSIBLE_EXACT: 1,
  STRUCTURAL: 2,
  BROAD_GENERIC: 3
});

export const HEALTH = Object.freeze({
  PASS: "PASS",
  DEGRADED: "DEGRADED",
  FAIL: "FAIL"
});

export function isUsableNode(node, host) {
  if (!node) return false;
  if (typeof node.isConnected === "boolean" && !node.isConnected) return false;
  const rect = typeof node.getBoundingClientRect === "function"
    ? node.getBoundingClientRect()
    : (host?.rectFor?.(node) || { width: 1, height: 1 });
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  const style = host?.styleFor?.(node) || { visibility: "visible", display: "block" };
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (node.hasAttribute?.("hidden")) return false;
  return true;
}

export function isEnabledControl(node) {
  if (!node) return false;
  if (node.disabled === true) return false;
  const aria = node.getAttribute?.("aria-disabled");
  if (aria === "true") return false;
  return true;
}

export function evaluateContracts(contracts, host, opts = {}) {
  const requireEnabled = Boolean(opts.requireEnabled);
  const results = [];

  for (const contract of contracts) {
    let nodes = [];
    try {
      nodes = host.queryAll(contract.selector) || [];
    } catch (err) {
      results.push({
        id: contract.id,
        selector: contract.selector,
        rank: contract.rank,
        matchCount: 0,
        usableCount: 0,
        state: HEALTH.FAIL,
        reason: `selector-threw:${err?.message || "error"}`
      });
      continue;
    }

    const usable = nodes.filter((node) => {
      if (!isUsableNode(node, host)) return false;
      if ((requireEnabled || contract.requiresEnabled) && !isEnabledControl(node)) return false;
      return true;
    });

    const rejectAmbiguous = contract.rejectIfAmbiguous !== false;
    let state = HEALTH.FAIL;
    let reason = "no-usable-match";

    if (usable.length === 1 && contract.rank <= RANK.ACCESSIBLE_EXACT) {
      state = HEALTH.PASS;
      reason = "unique-semantic-or-accessible";
    } else if (usable.length === 1 && contract.rank === RANK.STRUCTURAL) {
      state = HEALTH.DEGRADED;
      reason = "unique-structural";
    } else if (usable.length > 1 && contract.rank <= RANK.STRUCTURAL) {
      state = rejectAmbiguous ? HEALTH.DEGRADED : HEALTH.PASS;
      reason = rejectAmbiguous ? "ambiguous-match" : "multi-match-allowed";
    } else if (usable.length >= 1 && contract.rank === RANK.BROAD_GENERIC) {
      state = HEALTH.FAIL;
      reason = "broad-generic-telemetry-only";
    }

    results.push({
      id: contract.id,
      selector: contract.selector,
      rank: contract.rank,
      matchCount: nodes.length,
      usableCount: usable.length,
      state,
      reason,
      nodeConnected: usable[0] ? usable[0].isConnected !== false : false
    });
  }

  return results;
}

export function pickAuthority(results) {
  const pass = results.find((r) => r.state === HEALTH.PASS && r.usableCount === 1);
  if (pass) {
    return {
      state: HEALTH.PASS,
      selectorId: pass.id,
      matchCount: pass.usableCount,
      reason: pass.reason,
      nodeConnected: pass.nodeConnected
    };
  }

  const degradedUnique = results.find((r) => r.state === HEALTH.DEGRADED && r.usableCount === 1);
  if (degradedUnique) {
    return {
      state: HEALTH.DEGRADED,
      selectorId: degradedUnique.id,
      matchCount: degradedUnique.usableCount,
      reason: degradedUnique.reason,
      nodeConnected: degradedUnique.nodeConnected
    };
  }

  const any = results.find((r) => r.usableCount > 0);
  return {
    state: HEALTH.FAIL,
    selectorId: any?.id || null,
    matchCount: any?.usableCount || 0,
    reason: any?.reason || "no-contract-matched",
    nodeConnected: Boolean(any?.nodeConnected)
  };
}

export function canAuthorizeAction(authority) {
  return authority?.state === HEALTH.PASS && authority.matchCount === 1 && authority.nodeConnected;
}
