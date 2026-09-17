from pathlib import Path


def load(path: str):
    p = Path(path)
    return p, p.read_text(encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# v1.13: source artifact allowlist became self-contained constants instead of
# literals inside the extracted function. Supply the same globals to the VM
# harness and keep its cloud-layout model synchronized with Focus.
p, s = load("tests/v1.13-security.mjs")
s = replace_once(
    s,
    "const allowSandbox = { URL };",
    '''const allowSandbox = {
  URL,
  ARTIFACT_EXACT_HOSTS: new Set([
    "chatgpt.com", "chat.openai.com", "grok.com", "assets.grok.com",
    "assets.grokusercontent.com", "claude.ai", "gemini.google.com", "copilot.microsoft.com"
  ]),
  ARTIFACT_HOST_SUFFIXES: Object.freeze([".oaiusercontent.com", ".googleusercontent.com", ".anthropic.com"])
};''',
    "v1.13 allowlist VM globals",
)
s = replace_once(
    s,
    'ALLOWED_CLOUD_LAYOUTS: new Set(["studio", "classic"]),',
    'ALLOWED_CLOUD_LAYOUTS: new Set(["studio", "classic", "focus"]),',
    "v1.13 Focus cloud layout",
)
p.write_text(s, encoding="utf-8")

# v1.15: implicit Google Web OAuth is intentionally absent from background.js.
p, s = load("tests/v1.15-settings.mjs")
s = replace_once(
    s,
    '''assert.match(background, /launchWebAuthFlow/);
assert.match(background, /https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
assert.match(background, /response_type: "token"/);''',
    '''assert.doesNotMatch(background, /launchWebAuthFlow/);
assert.match(background, /Google Drive Web implicit OAuth is disabled/);
assert.doesNotMatch(background, /response_type:\s*"token"/);''',
    "v1.15 implicit OAuth expectations",
)
p.write_text(s, encoding="utf-8")

# Reconnect runtime/content stack is v1.17.0 and includes the artifact-security
# prelude before completion monitoring.
p, s = load("tests/v1.16.3-reconnect-hardening.mjs")
if s.count('"1.16.4"') < 1:
    raise SystemExit("reconnect string version pins were not found")
s = s.replace('"1.16.4"', '"1.17.0"')
s = replace_once(
    s,
    '''  "content-runtime-prelude.js",
  "content-completion-guard.js",''',
    '''  "content-runtime-prelude.js",
  "content-artifact-security-prelude.js",
  "content-completion-guard.js",''',
    "reconnect content-script stack",
)
s = replace_once(
    s,
    'assert.match(source, /EXPECTED_CONTENT_VERSION\\s*=\\s*"1\\.16\\.4"/);',
    'assert.match(source, /EXPECTED_CONTENT_VERSION\\s*=\\s*"1\\.17\\.0"/);',
    "reconnect source version regex",
)
s = s.replace("v1.16.4 reconnect/content integrity regression passed", "v1.17 reconnect/content integrity regression passed")
p.write_text(s, encoding="utf-8")

# v1.17 security/UI: CSP final semicolon is optional and manual relay now checks
# the raw capture result before building the normalized captured object.
p, s = load("tests/v1.17-security-ui.mjs")
s = replace_once(
    s,
    "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';",
    "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "CSP canonical value",
)
s = replace_once(
    s,
    'assert.match(manualRelay, /captured\\?\\.generating/);',
    'assert.match(manualRelay, /result\\.generating/);',
    "manual relay generating assertion",
)
p.write_text(s, encoding="utf-8")

print("Applied four locally validated regression-drift corrections.")
