/**
 * provider-dom-contracts.js
 * Review-only selector contracts. Broad selectors are telemetry-only and must
 * never independently authorize Send/New Chat/Stop/Upload actions.
 */
import { RANK } from "./selector-ranking.js";

function freezeContracts(items) {
  return Object.freeze(items.map(item => Object.freeze({ ...item })));
}

export const PROVIDER_CONTRACTS = Object.freeze({
  chatgpt: Object.freeze({
    composer: freezeContracts([
      { id: "chatgpt-composer-testid", selector: "#prompt-textarea", rank: RANK.EXACT_SEMANTIC },
      { id: "chatgpt-composer-contenteditable", selector: "div[contenteditable='true'][data-virtualkeyboard='true']", rank: RANK.STRUCTURAL },
      { id: "chatgpt-composer-broad", selector: "div[contenteditable='true']", rank: RANK.BROAD_GENERIC }
    ]),
    send: freezeContracts([
      { id: "chatgpt-send-testid", selector: "button[data-testid='send-button']", rank: RANK.EXACT_SEMANTIC, requiresEnabled: true },
      { id: "chatgpt-send-aria", selector: "button[aria-label='Send prompt']", rank: RANK.ACCESSIBLE_EXACT, requiresEnabled: true }
    ]),
    stop: freezeContracts([
      { id: "chatgpt-stop-testid", selector: "button[data-testid='stop-button']", rank: RANK.EXACT_SEMANTIC },
      { id: "chatgpt-stop-aria", selector: "button[aria-label='Stop generating']", rank: RANK.ACCESSIBLE_EXACT }
    ]),
    response: freezeContracts([
      { id: "chatgpt-assistant-role", selector: "[data-message-author-role='assistant'] .markdown", rank: RANK.EXACT_SEMANTIC },
      { id: "chatgpt-assistant-container", selector: "[data-message-author-role='assistant']", rank: RANK.ACCESSIBLE_EXACT }
    ])
  }),
  grok: Object.freeze({
    composer: freezeContracts([
      { id: "grok-composer-ask", selector: "textarea[placeholder*='Ask']", rank: RANK.ACCESSIBLE_EXACT },
      { id: "grok-composer-editable", selector: "div[contenteditable='true'][aria-label*='Grok']", rank: RANK.ACCESSIBLE_EXACT },
      { id: "grok-composer-broad", selector: "textarea, div[contenteditable='true']", rank: RANK.BROAD_GENERIC }
    ]),
    send: freezeContracts([
      { id: "grok-send-aria", selector: "button[aria-label='Send message']", rank: RANK.ACCESSIBLE_EXACT, requiresEnabled: true },
      { id: "grok-send-submit", selector: "button[type='submit']", rank: RANK.STRUCTURAL, requiresEnabled: true }
    ]),
    stop: freezeContracts([
      { id: "grok-stop-aria", selector: "button[aria-label='Stop']", rank: RANK.ACCESSIBLE_EXACT }
    ]),
    response: freezeContracts([
      { id: "grok-message-testid", selector: "[data-testid='message-text']", rank: RANK.EXACT_SEMANTIC },
      { id: "grok-message-broad", selector: "article, div[class*='message']", rank: RANK.BROAD_GENERIC }
    ])
  }),
  claude: Object.freeze({
    composer: freezeContracts([{ id: "claude-composer-prosemirror", selector: ".ProseMirror[contenteditable='true']", rank: RANK.STRUCTURAL }]),
    send: freezeContracts([{ id: "claude-send-aria", selector: "button[aria-label='Send Message']", rank: RANK.ACCESSIBLE_EXACT, requiresEnabled: true }]),
    stop: freezeContracts([{ id: "claude-stop-aria", selector: "button[aria-label='Stop Response']", rank: RANK.ACCESSIBLE_EXACT }]),
    response: freezeContracts([{ id: "claude-response-stream", selector: "div[data-is-streaming]", rank: RANK.STRUCTURAL }])
  }),
  gemini: Object.freeze({
    composer: freezeContracts([{ id: "gemini-rich-textarea", selector: "rich-textarea div[contenteditable='true']", rank: RANK.EXACT_SEMANTIC }]),
    send: freezeContracts([{ id: "gemini-send-aria", selector: "button[aria-label='Send message']", rank: RANK.ACCESSIBLE_EXACT, requiresEnabled: true }]),
    stop: freezeContracts([{ id: "gemini-stop-aria", selector: "button[aria-label*='Stop']", rank: RANK.STRUCTURAL }]),
    response: freezeContracts([{ id: "gemini-response-message", selector: "message-content", rank: RANK.EXACT_SEMANTIC }])
  }),
  copilot: Object.freeze({
    composer: freezeContracts([{ id: "copilot-searchbox", selector: "textarea#searchbox", rank: RANK.EXACT_SEMANTIC }]),
    send: freezeContracts([{ id: "copilot-send-aria", selector: "button[aria-label*='Submit']", rank: RANK.STRUCTURAL, requiresEnabled: true }]),
    stop: freezeContracts([{ id: "copilot-stop-aria", selector: "button[aria-label*='Stop']", rank: RANK.STRUCTURAL }]),
    response: freezeContracts([{ id: "copilot-message", selector: "cib-message", rank: RANK.EXACT_SEMANTIC }])
  })
});

export function getProviderContracts(provider) {
  return PROVIDER_CONTRACTS[String(provider || "").toLowerCase()] || null;
}
