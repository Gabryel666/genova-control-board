#!/usr/bin/env python3
"""Assemble the shippable Stream Deck plugin into `assets/`.

Rollup compiles `src/` into `assets/com.genova.control-board.sdPlugin/bin/plugin.js`;
this script copies the static parts (manifest, property inspectors, icons) next to it,
so a fresh clone can be installed on a Stream Deck without running Node at all.

Run from anywhere: `python3 streamdeck/sync_assets.py`.
"""

from __future__ import annotations

import filecmp
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DEST = REPO / "assets" / "com.genova.control-board.sdPlugin"

STATIC = ["manifest.json", "ui", "imgs"]


def copy_tree(src: Path, dst: Path) -> int:
    """Copy a directory, skipping identical files. Returns the number copied."""
    copied = 0
    for item in sorted(src.rglob("*")):
        if not item.is_file():
            continue
        target = dst / item.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and filecmp.cmp(item, target, shallow=False):
            continue
        shutil.copy2(item, target)
        copied += 1
    return copied


def main() -> int:
    DEST.mkdir(parents=True, exist_ok=True)
    copied = 0

    for name in STATIC:
        source = HERE / name
        if not source.exists():
            print(f"manquant dans les sources : {source}", file=sys.stderr)
            return 1
        if source.is_dir():
            copied += copy_tree(source, DEST / name)
        else:
            shutil.copy2(source, DEST / name)
            copied += 1

    bundle = DEST / "bin" / "plugin.js"
    if not bundle.exists():
        print("bin/plugin.js absent — lancer `npx rollup -c` d'abord", file=sys.stderr)
        return 1

    manifest = json.loads((DEST / "manifest.json").read_text(encoding="utf-8"))
    print(f"{manifest['UUID']} v{manifest['Version']} assemblé dans {DEST.relative_to(REPO)} ({copied} fichiers mis à jour)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
