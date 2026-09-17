from pathlib import Path

path = Path("background.js")
src = path.read_text(encoding="utf-8")
original = src

constants = '''const ARTIFACT_EXACT_HOSTS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "grok.com",
  "assets.grok.com",
  "assets.grokusercontent.com",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com"
]);
const ARTIFACT_HOST_SUFFIXES = Object.freeze([
  ".oaiusercontent.com",
  ".googleusercontent.com",
  ".anthropic.com"
]);

'''

marker = "function artifactFetchHostAllowed(rawUrl) {"
if "const ARTIFACT_EXACT_HOSTS = new Set([" not in src:
    if src.count(marker) != 1:
        raise SystemExit(f"artifact allowlist insertion anchor count={src.count(marker)}")
    src = src.replace(marker, constants + marker, 1)

if "EXACT_HOSTS.has(host)" in src:
    if src.count("EXACT_HOSTS.has(host)") != 1:
        raise SystemExit("unexpected EXACT_HOSTS references")
    src = src.replace("EXACT_HOSTS.has(host)", "ARTIFACT_EXACT_HOSTS.has(host)", 1)

if "HOST_SUFFIXES.some(" in src:
    if src.count("HOST_SUFFIXES.some(") != 1:
        raise SystemExit("unexpected HOST_SUFFIXES references")
    src = src.replace("HOST_SUFFIXES.some(", "ARTIFACT_HOST_SUFFIXES.some(", 1)

# Remove the old insecure spelling even from comments so source-audit tests can
# assert that the primitive is absent without false positives.
src = src.replace(
    '// IMPORTANT: do not use credentials:"include" here. A model-controlled',
    '// IMPORTANT: never attach ambient browser credentials here. A model-controlled',
    1,
)

required = [
    'credentials: "omit"',
    'referrerPolicy: "no-referrer"',
    'cache: "no-store"',
    'readResponseBytesBounded',
    'ARTIFACT_EXACT_HOSTS.has(host)',
    'ARTIFACT_HOST_SUFFIXES.some(',
    'const ALLOWED_CLOUD_LAYOUTS = new Set(["studio", "classic", "focus"]);',
    'msg.observed !== true',
    'Google Drive Web implicit OAuth is disabled.',
]
for needle in required:
    if needle not in src:
        raise SystemExit(f"required source hardening missing: {needle}")

forbidden = [
    'credentials: "include"',
    'credentials:"include"',
    'response_type: "token"',
    'host === "x.ai"',
    'host.endsWith(".x.ai")',
    'host.endsWith(".microsoft.com")',
]
for needle in forbidden:
    if needle in src:
        raise SystemExit(f"forbidden source primitive remains: {needle}")

if src != original:
    path.write_text(src, encoding="utf-8")
    print("background.js made self-contained")
else:
    print("background.js already self-contained")
