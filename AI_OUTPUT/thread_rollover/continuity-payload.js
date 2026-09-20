"use strict";

const MAX_ROMAN_VALUE = 3999;
const DEFAULT_MAX_CONTINUITY_CHARS = 200000;
const ROMAN_SUFFIX_RE = /\s+-\s+([IVXLCDM]+)$/i;

function nonEmptyText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${name} must be a non-empty string.`);
  return text;
}

function toRoman(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_ROMAN_VALUE) {
    throw new RangeError(`Roman numeral value must be an integer from 1 to ${MAX_ROMAN_VALUE}.`);
  }
  const table = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let remaining = n;
  let out = "";
  for (const [amount, numeral] of table) {
    while (remaining >= amount) {
      out += numeral;
      remaining -= amount;
    }
  }
  return out;
}

function fromRoman(value) {
  const roman = String(value ?? "").trim().toUpperCase();
  if (!roman || !/^[IVXLCDM]+$/.test(roman)) return null;
  const values = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 };
  let total = 0;
  for (let i = 0; i < roman.length; i += 1) {
    const current = values[roman[i]];
    const next = values[roman[i + 1]] || 0;
    total += current < next ? -current : current;
  }
  if (total < 1 || total > MAX_ROMAN_VALUE) return null;
  return toRoman(total) === roman ? total : null;
}

function splitContinuationTitle(title) {
  const clean = nonEmptyText(title, "title");
  const match = clean.match(ROMAN_SUFFIX_RE);
  if (!match) return Object.freeze({ baseTitle: clean, sequence: 1 });
  const parsed = fromRoman(match[1]);
  if (parsed == null || parsed < 2) return Object.freeze({ baseTitle: clean, sequence: 1 });
  const baseTitle = clean.slice(0, match.index).trim();
  if (!baseTitle) return Object.freeze({ baseTitle: clean, sequence: 1 });
  return Object.freeze({ baseTitle, sequence: parsed });
}

function nextContinuationTitle(title) {
  const parsed = splitContinuationTitle(title);
  const nextSequence = parsed.sequence + 1;
  if (nextSequence > MAX_ROMAN_VALUE) throw new RangeError("Continuation title sequence exceeds supported Roman numeral range.");
  return `${parsed.baseTitle} - ${toRoman(nextSequence)}`;
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object") return null;
  const role = String(message.role || "").trim().toLowerCase();
  const text = String(message.text ?? "");
  const completed = message.completed !== false;
  const kind = String(message.kind || "").trim().toLowerCase();
  return { role, text, completed, kind };
}

function lastCompletedAssistantMessage(messages, { maxChars = DEFAULT_MAX_CONTINUITY_CHARS } = {}) {
  const limit = Number(maxChars);
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError("maxChars must be a positive integer.");
  if (!Array.isArray(messages)) throw new TypeError("messages must be an array.");
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = normalizeMessage(messages[i]);
    if (!message || message.role !== "assistant" || !message.completed) continue;
    if (message.kind === "provider-notice" || message.kind === "system-banner" || message.kind === "composer-status") continue;
    const text = message.text.trim();
    if (!text) continue;
    if (text.length > limit) throw new RangeError(`Last completed assistant message exceeds continuity limit of ${limit} characters.`);
    return Object.freeze({ text, index: i });
  }
  return null;
}

function buildContinuationPayload({ title, messages, provider, limitEvidence, maxChars = DEFAULT_MAX_CONTINUITY_CHARS } = {}) {
  const providerName = nonEmptyText(provider, "provider").toLowerCase();
  if (!limitEvidence || limitEvidence.state !== "HARD_THREAD_LIMIT" || limitEvidence.automaticRollover !== true) {
    throw new Error("Continuation payload requires authoritative HARD_THREAD_LIMIT evidence.");
  }
  const last = lastCompletedAssistantMessage(messages, { maxChars });
  if (!last) throw new Error("No completed assistant message is available for rollover continuity.");
  const previousTitle = nonEmptyText(title, "title");
  return Object.freeze({
    schema: 1,
    provider: providerName,
    previousTitle,
    nextTitle: nextContinuationTitle(previousTitle),
    lastAssistantMessage: last.text,
    sourceMessageIndex: last.index
  });
}

module.exports = Object.freeze({
  MAX_ROMAN_VALUE,
  DEFAULT_MAX_CONTINUITY_CHARS,
  toRoman,
  fromRoman,
  splitContinuationTitle,
  nextContinuationTitle,
  lastCompletedAssistantMessage,
  buildContinuationPayload
});
