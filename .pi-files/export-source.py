"""Export all cheat-codes repo source files into one markdown file.

Usage: python3 .pi-files/export-source.py [output.md]
Default output: <root>/.pi-files/<project-name>-source.md

Bundles root configs, AGENTS.md, TypeScript sources, tests, and the
.cheatcodes knowledge base. Excludes package-lock.json, node_modules,
dist, .cheatcodes/local runtime state, and .cheatcodes/curated
(byte-identical duplicates of knowledge/concepts).
"""

from __future__ import annotations

import hashlib
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PATTERNS: list[str] = [
    "package.json",
    "tsconfig.json",
    "AGENTS.md",
    "src/**/*.ts",
    "test/**/*.ts",
    ".cheatcodes/project.json",
    ".cheatcodes/knowledge/**/*.md",
]

LANGUAGES = {".ts": "typescript", ".json": "json", ".md": "markdown"}


def collect_rel_paths() -> list[Path]:
    seen: set[Path] = set()
    rel_paths: list[Path] = []
    for pattern in PATTERNS:
        for path in sorted(ROOT.glob(pattern)):
            if path.is_file() and path not in seen:
                seen.add(path)
                rel_paths.append(path.relative_to(ROOT))
    return rel_paths


def fence_for(content: str) -> str:
    """Return a backtick fence longer than any backtick run in content."""
    longest = 0
    run = 0
    for ch in content:
        if ch == "`":
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    return "`" * max(3, longest + 1)


def main() -> int:
    default_output = ROOT / ".pi-files" / f"{ROOT.name}-source.md"
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else default_output

    files = []
    for rel in collect_rel_paths():
        content = (ROOT / rel).read_text(encoding="utf-8")
        files.append((rel.as_posix(), content))

    total_lines = sum(content.count("\n") + 1 for _, content in files)
    total_bytes = sum(len(content.encode()) for _, content in files)

    lines: list[str] = []
    lines.append(f"# {ROOT.name} - source bundle")
    lines.append("")
    lines.append(f"- generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    lines.append(f"- files: {len(files)}")
    lines.append(f"- total: {total_lines:,} lines / {total_bytes:,} bytes")
    lines.append("- scope: repo source + cheat-codes knowledge base (no node_modules, no dist, no package-lock, no curated duplicates, no local runtime state)")
    lines.append("")
    lines.append("## contents")
    lines.append("")
    lines.append("| file | lines | bytes | sha256 |")
    lines.append("| --- | ---: | ---: | --- |")
    for rel, content in files:
        digest = hashlib.sha256(content.encode()).hexdigest()
        lines.append(
            f"| [{rel}](#{rel.replace('/', '').replace('.', '')}) "
            f"| {content.count(chr(10)) + 1:,} | {len(content.encode()):,} | `{digest[:16]}` |"
        )
    lines.append("")

    for rel, content in files:
        fence = fence_for(content)
        language = LANGUAGES.get(Path(rel).suffix, "")
        lines.append(f"## `{rel}`")
        lines.append("")
        lines.append(f"{fence}{language}")
        lines.append(content.rstrip("\n"))
        lines.append(fence)
        lines.append("")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {output} ({len(files)} files, {total_lines:,} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
