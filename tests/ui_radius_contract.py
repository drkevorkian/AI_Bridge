from pathlib import Path
import re
import sys

UI_FILES = (
    Path("dashboard.css"),
    Path("dashboard-layouts.css"),
    Path("popup.css"),
    Path("settings.css"),
    Path("dashboard.html"),
    Path("popup.html"),
    Path("settings.html"),
    Path("dashboard.js"),
    Path("popup.js"),
    Path("settings.js"),
)

MAX_RADIUS_PX = 8.0
RADIUS_RE = re.compile(
    r"(?:border-radius|borderRadius)\\s*[:=]\\s*[\"']?([^;\"'}\\n]+)",
    re.IGNORECASE,
)
PX_RE = re.compile(r"(-?\\d+(?:\\.\\d+)?)px", re.IGNORECASE)
PERCENT_RE = re.compile(r"(-?\\d+(?:\\.\\d+)?)%", re.IGNORECASE)

violations = []

for path in UI_FILES:
    if not path.exists():
        continue
    text = path.read_text(encoding="utf-8")
    for line_no, line in enumerate(text.splitlines(), 1):
        for match in RADIUS_RE.finditer(line):
            value = match.group(1).strip()
            for px in PX_RE.findall(value):
                if float(px) > MAX_RADIUS_PX:
                    violations.append(
                        f"{path}:{line_no}: border radius {px}px exceeds {MAX_RADIUS_PX:g}px: {line.strip()}"
                    )
            for pct in PERCENT_RE.findall(value):
                if float(pct) > 0:
                    violations.append(
                        f"{path}:{line_no}: percentage border radius is not allowed: {line.strip()}"
                    )

if violations:
    print("UI radius contract failed:")
    for violation in violations:
        print(f" - {violation}")
    sys.exit(1)

print("UI radius contract passed: no radius exceeds 8px and no percentage radii are used.")
