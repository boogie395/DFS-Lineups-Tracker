#!/usr/bin/env python3
"""Rebuild data/manifest.json from CSV files under data/.

GitHub Pages is a static host, so the site cannot list the data folder.
It loads data/manifest.json and fetches each path inside it.

    python3 scripts/build_manifest.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
MANIFEST = DATA / "manifest.json"


def csv_files() -> list[str]:
    paths = []
    for path in DATA.rglob("*.csv"):
        if not path.is_file():
            continue
        relative = path.relative_to(DATA)
        if any(part.startswith(".") for part in relative.parts):
            continue
        paths.append(path.relative_to(ROOT).as_posix())
    return sorted(paths)


def main() -> None:
    files = csv_files()
    MANIFEST.write_text(json.dumps({"files": files}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(files)} file(s) to {MANIFEST.relative_to(ROOT).as_posix()}")
    for path in files:
        print(f"  {path}")


if __name__ == "__main__":
    main()
