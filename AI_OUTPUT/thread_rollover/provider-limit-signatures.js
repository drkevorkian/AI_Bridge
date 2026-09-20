'use strict';

/**
 * Review-only provider thread-limit classifier.
 *
 * SECURITY MODEL
 * --------------
 * Provider DOM and model output are untrusted.  This module never inspects raw
 * HTML, executes page data, or treats ordinary assistant-response text as
 * authority.  Callers must pre-classify observations into trusted UI regions
 * (for example a provider system banner or composer status) before passing
 * text here.
 */
(function initProviderLimitSignatures(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.AIBridgeProviderLimitSignatures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PROVIDERS = Object.freeze(['chatgpt', 'grok', 'claude', 'gemini', 'copilot']);
  const AUTHORITATIVE_REGION_KINDS = new Set(['system-banner', 'composer-status', 'provider-notice']);
  const NON_AUTHORITATIVE_REGION_KINDS = new Set(['assistant-response', 'user-message', 'transcript']);

  const RULES = Object.freeze({
    chatgpt: Object.freeze({
      hard: Object.freeze([
        /you(?:'|’)ve reached the maximum length for this conversation/i,
        /maximum length for this conversation/i,
        /start(?:ing)? a new chat to continue/i
      ]),
      exclusions: Object.freeze([
        /limit of messages/i,
        /usage limit/i,
        /try again in\s+\d+/i,
        /upload limit/i,
        /network error/i,
        /something went wrong/i,
        /error in message stream/i
      ])
    }),
    grok: Object.freeze({
      hard: Object.freeze([]),
      exclusions: Object.freeze([
        /rate limit/i,
        /usage limit/i,
        /network error/i,
        /something went wrong/i
      ])
    }),
    claude: Object.freeze({
      hard: Object.freeze([]),
      exclusions: Object.freeze([
        /usage limit/i,
        /rate limit/i,
        /resets? at/i,
        /compacted/i,
        /compaction/i
      ])
    }),
    gemini: Object.freeze({
      hard: Object.freeze([]),
      exclusions: Object.freeze([
        /usage limit/i,
        /rate limit/i,
        /try again later/i,
        /network error/i
      ])
    }),
    copilot: Object.freeze({
      hard: Object.freeze([]),
      exclusions: Object.freeze([
        /rate limit/i,
        /usage limit/i,
        /network error/i
      ])
    })
  });

  function normalizeProvider(value) {
    const provider = String(value || '').trim().toLowerCase();
    return PROVIDERS.includes(provider) ? provider : null;
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
  }

  function normalizeRegion(region) {
    if (!region || typeof region !== 'object') return null;
    const kind = String(region.kind || '').trim().toLowerCase();
    const text = normalizeText(region.text);
    const visible = region.visible !== false;
    return { kind, text, visible };
  }

  function classifyThreadLimit(observation) {
    const provider = normalizeProvider(observation?.provider);
    if (!provider) {
      return Object.freeze({
        provider: null,
        state: 'UNKNOWN_PROVIDER',
        automaticRollover: false,
        reason: 'Provider is not supported.'
      });
    }

    const rules = RULES[provider];
    const regions = Array.isArray(observation?.regions)
      ? observation.regions.map(normalizeRegion).filter(Boolean)
      : [];

    // Never promote ordinary model/user transcript text into control authority.
    const trusted = regions.filter(region =>
      region.visible && AUTHORITATIVE_REGION_KINDS.has(region.kind) && region.text
    );

    const untrustedMatches = regions.some(region =>
      region.visible && NON_AUTHORITATIVE_REGION_KINDS.has(region.kind) &&
      rules.hard.some(pattern => pattern.test(region.text))
    );

    const joined = trusted.map(region => region.text).join(' | ');
    if (!joined) {
      return Object.freeze({
        provider,
        state: untrustedMatches ? 'UNTRUSTED_TEXT_ONLY' : 'NO_LIMIT_SIGNAL',
        automaticRollover: false,
        reason: untrustedMatches
          ? 'Limit-like text appeared only in non-authoritative transcript content.'
          : 'No authoritative provider limit signal was observed.'
      });
    }

    if (rules.exclusions.some(pattern => pattern.test(joined))) {
      return Object.freeze({
        provider,
        state: 'NON_THREAD_LIMIT',
        automaticRollover: false,
        reason: 'Observed provider UI indicates quota, transport, upload, or another non-thread limit.'
      });
    }

    const hardMatch = rules.hard.some(pattern => pattern.test(joined));
    if (!hardMatch) {
      return Object.freeze({
        provider,
        state: 'NO_LIMIT_SIGNAL',
        automaticRollover: false,
        reason: rules.hard.length === 0
          ? `No packaged ${provider} hard-limit signature is trusted yet.`
          : 'Authoritative provider UI did not match a packaged hard thread-limit signature.'
      });
    }

    const composerPresent = observation?.composer?.present === true;
    const composerDisabled = observation?.composer?.disabled === true;
    const strongerEvidence = composerPresent && composerDisabled;

    return Object.freeze({
      provider,
      state: 'HARD_THREAD_LIMIT',
      automaticRollover: true,
      confidence: strongerEvidence ? 'HIGH' : 'AUTHORITATIVE_TEXT',
      reason: strongerEvidence
        ? 'Hard thread-limit UI matched and composer is disabled.'
        : 'Hard thread-limit UI matched in an approved provider control region.'
    });
  }

  return Object.freeze({
    PROVIDERS,
    AUTHORITATIVE_REGION_KINDS,
    classifyThreadLimit
  });
});
