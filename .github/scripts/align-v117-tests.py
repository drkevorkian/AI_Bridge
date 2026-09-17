from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match in {path}, found {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


old_wrapper_assert = '''assert.match(
  wrapper,
  /importScripts\\("background\\.js",\\s*"completion-runtime-hardening\\.js",\\s*"oauth-runtime-hardening\\.js",\\s*"power\\.js"\\)/,
  "OAuth hardening must load with the coordinator core helpers"
);'''
new_wrapper_assert = '''const backgroundIndex = wrapper.indexOf('importScripts("background.js")');
const artifactIndex = wrapper.indexOf('importScripts("artifact-fetch-runtime-hardening.js")');
const updateIndex = wrapper.indexOf('importScripts("update-runtime-hardening.js")');
const helperIndex = wrapper.indexOf('importScripts("completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js")');
assert.ok(backgroundIndex >= 0, "coordinator source must load through the wrapper");
assert.ok(artifactIndex > backgroundIndex, "artifact hardening must replace privileged source helpers immediately after background.js");
assert.ok(updateIndex > artifactIndex, "immutable updater hardening must load after artifact hardening");
assert.ok(helperIndex > updateIndex, "OAuth/power helpers must load only after privileged network paths are hardened");'''
replace_once("tests/v1.16-oauth-callback-hotfix.mjs", old_wrapper_assert, new_wrapper_assert, "OAuth callback wrapper order")

old_oauth_power_wrapper = 'assert.match(wrapper, /importScripts\\("background\\.js",\\s*"completion-runtime-hardening\\.js",\\s*"oauth-runtime-hardening\\.js",\\s*"power\\.js"\\)/);'
new_oauth_power_wrapper = '''const backgroundIndex = wrapper.indexOf('importScripts("background.js")');
const artifactIndex = wrapper.indexOf('importScripts("artifact-fetch-runtime-hardening.js")');
const updateIndex = wrapper.indexOf('importScripts("update-runtime-hardening.js")');
const helperIndex = wrapper.indexOf('importScripts("completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js")');
assert.ok(backgroundIndex >= 0 && artifactIndex > backgroundIndex && updateIndex > artifactIndex && helperIndex > updateIndex);'''
replace_once("tests/v1.16-oauth-power.mjs", old_oauth_power_wrapper, new_oauth_power_wrapper, "OAuth/power wrapper order")
replace_once(
    "tests/v1.16-oauth-power.mjs",
    'assert.match(background, /Refusing the Google token/);',
    'assert.match(background, /Google Drive Web implicit OAuth is disabled/);\nassert.doesNotMatch(background, /response_type:\\s*"token"/);',
    "OAuth source fail-closed wording",
)

old_completion_wrapper = '''assert.match(
  wrapper,
  /importScripts\\("background\\.js",\\s*"completion-runtime-hardening\\.js",\\s*"oauth-runtime-hardening\\.js",\\s*"power\\.js"\\)/
);'''
new_completion_wrapper = '''const backgroundIndex = wrapper.indexOf('importScripts("background.js")');
const completionHelperIndex = wrapper.indexOf('importScripts("completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js")');
assert.ok(backgroundIndex >= 0, "background.js must load through the service-worker wrapper");
assert.ok(completionHelperIndex > backgroundIndex, "completion hardening must load after the coordinator source");'''
replace_once("tests/v1.16.3-completion.mjs", old_completion_wrapper, new_completion_wrapper, "completion wrapper order")
replace_once(
    "tests/v1.16.3-completion.mjs",
    '["content-runtime-prelude.js", "content-completion-guard.js", "content-response-delivery-hardening.js", "content.js"]',
    '["content-runtime-prelude.js", "content-artifact-security-prelude.js", "content-completion-guard.js", "content-response-delivery-hardening.js", "content.js"]',
    "completion content-script stack",
)

old_human_wrapper = '''assert.match(
  wrapper,
  /importScripts\\("background\\.js",\\s*"completion-runtime-hardening\\.js",\\s*"oauth-runtime-hardening\\.js",\\s*"power\\.js"\\)/,
  "established service-worker bootstrap chain must remain intact"
);'''
new_human_wrapper = '''const backgroundIndex = wrapper.indexOf('importScripts("background.js")');
const helperIndex = wrapper.indexOf('importScripts("completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js")');
const humanInputIndex = wrapper.indexOf('importScripts("human-input-runtime-hardening.js")');
assert.ok(backgroundIndex >= 0, "background.js must load through the service-worker wrapper");
assert.ok(helperIndex > backgroundIndex, "established helper chain must load after the hardened coordinator source");
assert.ok(humanInputIndex > helperIndex, "human-input control-plane hardening must load after coordinator helpers");'''
replace_once("tests/v1.16.3-human-input-hardening.mjs", old_human_wrapper, new_human_wrapper, "human-input wrapper order")

print("Aligned four stale regressions to the v1.17 worker/content architecture.")
