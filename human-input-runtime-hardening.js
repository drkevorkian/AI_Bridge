(() => {
  "use strict";

  // Human-input detection is a control-plane boundary: a false positive stops
  // normal A -> B -> C relay, while a false negative can make a model continue
  // when it genuinely needs an operator decision. Keep the explicit marker
  // strict and make the natural-language fallback intentionally conservative.
  //
  // In particular, do not treat quoted protocol text, fenced examples,
  // blockquotes, or relayed <untrusted_peer_data> as executable control signals.
  // Those are data, not commands to the Bridge runtime.

  const MAX_HUMAN_PROMPT_CHARS = 1200;
  const EXPLICIT_MARKER_TAIL_LINES = 4;
  const NATURAL_LANGUAGE_TAIL_LINES = 4;

  function aiBridgeRemoveUntrustedPeerBlocks(text) {
    return String(text || "").replace(
      /<untrusted_peer_data\b[^>]*>[\s\S]*?<\/untrusted_peer_data\s*>/gi,
      "\n"
    );
  }

  function aiBridgeHumanSignalLines(text) {
    const raw = aiBridgeRemoveUntrustedPeerBlocks(text);
    const out = [];
    let fence = null;

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = String(line || "").trim();
      const fenceMatch = trimmed.match(/^(```+|~~~+)/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!fence) fence = marker;
        else if (fence === marker) fence = null;
        continue;
      }
      if (fence || !trimmed) continue;

      // Markdown blockquotes and four-space indented code are explanatory data.
      if (/^>/.test(trimmed) || /^\s{4,}\S/.test(line)) continue;
      out.push(trimmed);
    }

    return out;
  }

  function aiBridgeExplicitHumanRequest(lines) {
    const marker = /^(?:\*\*|__)?\s*\[\[HUMAN_INPUT:\s*([\s\S]+?)\s*\]\]\s*(?:\*\*|__)?$/i;
    const tail = lines.slice(-EXPLICIT_MARKER_TAIL_LINES);

    for (let i = tail.length - 1; i >= 0; i -= 1) {
      const match = marker.exec(tail[i]);
      if (!match?.[1]?.trim()) continue;

      const prompt = match[1].trim().slice(0, MAX_HUMAN_PROMPT_CHARS);
      // Do not execute the literal placeholder from the team protocol if a model
      // happens to quote or repeat it as its final line.
      if (/\b(?:your specific question|decision request to the human|your question to the human)\b/i.test(prompt)) {
        continue;
      }
      return prompt;
    }
    return null;
  }

  function aiBridgeStripInlineExamples(text) {
    return String(text || "")
      .replace(/`[^`\n]*`/g, " ")
      .replace(/[“\"][^”\"\n]{0,800}[”\"]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function aiBridgeLooksPeerDirected(text) {
    // Team members commonly address one another explicitly. Those sentences
    // belong to the relay data plane, even when they contain language such as
    // "I need you to choose..." that would otherwise resemble an operator
    // request. Keep provider names here as aliases because the UI labels can
    // vary while the provider identity remains recognizable in responses.
    return /^(?:AI\s*[ABC]|ChatGPT|Grok|Gemini|Claude|Copilot)\s*[:,]/i.test(String(text || "").trim());
  }

  function aiBridgeNaturalHumanRequest(lines) {
    const tailLines = lines.slice(-NATURAL_LANGUAGE_TAIL_LINES);
    if (!tailLines.length) return null;

    const tail = aiBridgeStripInlineExamples(tailLines.join(" "));
    if (!tail) return null;

    const strongPatterns = [
      /\b(?:i|we)\s+(?:now\s+)?(?:need|require)\s+(?:your|the\s+human(?:\s+controller)?(?:['’]s)?|the\s+user(?:['’]s)?)\s+(?:input|decision|approval|permission|clarification|choice|confirmation)\b/i,
      /\b(?:i|we)\s+(?:now\s+)?(?:need|require)\s+(?:you|the\s+human(?:\s+controller)?|the\s+user)\s+to\s+(?:choose|select|decide|confirm|approve|clarify|provide|authorize)\b/i,
      /\b(?:i\s+(?:cannot|can't|can’t|am\s+unable\s+to)|we\s+(?:cannot|can't|can’t|are\s+unable\s+to))\s+(?:safely\s+)?(?:continue|proceed|finish|choose|decide)\b[^.?!]{0,220}\b(?:without|until)\b/i,
      /\b(?:i(?:['’]m|\s+am)|we(?:['’]re|\s+are))\s+(?:blocked|waiting)\s+(?:on|for)\s+(?:your|the\s+human(?:\s+controller)?(?:['’]s)?|the\s+user(?:['’]s)?)\s+(?:input|decision|approval|permission|clarification|choice|confirmation)\b/i
    ];

    const nonBlocking = /\b(?:optional|not required|no need to answer|do not need|don't need|don’t need|can continue without|can proceed without|could continue without|could proceed without)\b/i;
    const metaLead = /^\s*(?:for example|example\b|e\.g\.|the\s+(?:app|bridge|protocol|command|marker)\b|this\s+(?:command|marker)\b|references?\s+to\b)/i;
    const sentences = tail.match(/[^.?!]+[.?!]?/g) || [tail];

    for (let i = sentences.length - 1; i >= 0; i -= 1) {
      const sentence = sentences[i].trim();
      if (!sentence || nonBlocking.test(sentence) || metaLead.test(sentence) || aiBridgeLooksPeerDirected(sentence)) continue;
      if (strongPatterns.some(pattern => pattern.test(sentence))) {
        return sentence.slice(0, MAX_HUMAN_PROMPT_CHARS);
      }
    }

    // Preserve a narrow convenience fallback for a direct final question or
    // imperative. Unlike the old detector, this only considers the final
    // non-quoted line and rejects protocol/app-command/peer discussion.
    const finalLine = aiBridgeStripInlineExamples(tailLines[tailLines.length - 1]);
    if (!finalLine || nonBlocking.test(finalLine) || metaLead.test(finalLine)) return null;
    if (/\b(?:protocol|marker|app command|bridge command|human-input|human input protocol)\b/i.test(finalLine)) return null;
    if (aiBridgeLooksPeerDirected(finalLine)) return null;

    const directQuestion = /^(?:which|what)\s+(?:option|approach|version|path|scope|priority|choice)\s+(?:do\s+you\s+(?:want|prefer)|should\s+(?:i|we))\b.*\?\s*$/i;
    const directImperative = /^please\s+(?:choose|select|confirm|approve|decide|clarify|provide|authorize)\b.+[.?!]?$/i;
    if (directQuestion.test(finalLine) || directImperative.test(finalLine)) {
      return finalLine.slice(0, MAX_HUMAN_PROMPT_CHARS);
    }

    return null;
  }

  function hardenedExtractHumanRequest(text) {
    const lines = aiBridgeHumanSignalLines(text);
    if (!lines.length) return null;
    return aiBridgeExplicitHumanRequest(lines) || aiBridgeNaturalHumanRequest(lines);
  }

  if (typeof extractHumanRequest !== "function") {
    console.warn("AI Bridge human-input hardening could not attach to background runtime");
    return;
  }

  extractHumanRequest = hardenedExtractHumanRequest;
})();
