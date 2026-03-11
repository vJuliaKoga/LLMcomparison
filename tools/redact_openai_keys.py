#!/usr/bin/env python3
import argparse
import os
import re
import sys
from pathlib import Path
from typing import Iterable, Tuple

# Matches strings that look like OpenAI API keys starting with "sk-..."
# Includes "sk-proj-..." etc. We keep it broad but bounded to avoid eating punctuation.
KEY_REGEX = re.compile(r"\bsk-[A-Za-z0-9][A-Za-z0-9_\-]{9,}\b")

DEFAULT_EXCLUDES = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "venv",
    ".venv",
    "__pycache__",
    "dist",
    "build",
    ".idea",
    ".vscode",
    ".mypy_cache",
    ".pytest_cache",
}

BINARY_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
    ".pdf",
    ".zip", ".7z", ".rar", ".gz", ".bz2", ".xz",
    ".exe", ".dll", ".so", ".dylib",
    ".bin",
    ".pyc",
    ".mp3", ".mp4", ".mov", ".avi", ".mkv",
    ".woff", ".woff2", ".ttf", ".otf",
}

def is_probably_binary(path: Path) -> bool:
    if path.suffix.lower() in BINARY_EXTS:
        return True
    try:
        with path.open("rb") as f:
            chunk = f.read(4096)
        if b"\x00" in chunk:
            return True
    except Exception:
        # If we can't read it, skip it to be safe
        return True
    return False

def should_exclude(path: Path, root: Path, excludes: set[str]) -> bool:
    # Exclude any path that contains an excluded directory name in its relative parts
    try:
        rel_parts = path.relative_to(root).parts
    except ValueError:
        rel_parts = path.parts
    return any(part in excludes for part in rel_parts)

def iter_files(root: Path, excludes: set[str]) -> Iterable[Path]:
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune excluded directories in-place for speed
        dirnames[:] = [d for d in dirnames if d not in excludes]
        for name in filenames:
            yield Path(dirpath) / name

def redact_in_file(path: Path, placeholder: str, make_backup: bool, dry_run: bool) -> Tuple[int, int]:
    """
    Returns (num_replacements, num_matches_before) for the file.
    """
    if is_probably_binary(path):
        return (0, 0)

    try:
        original = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return (0, 0)

    matches = list(KEY_REGEX.finditer(original))
    if not matches:
        return (0, 0)

    redacted, n = KEY_REGEX.subn(placeholder, original)
    if n <= 0:
        return (0, len(matches))

    if dry_run:
        return (n, len(matches))

    try:
        if make_backup:
            backup_path = path.with_suffix(path.suffix + ".bak")
            # Avoid overwriting an existing backup
            if not backup_path.exists():
                backup_path.write_text(original, encoding="utf-8", errors="replace")

        path.write_text(redacted, encoding="utf-8", errors="replace")
    except Exception:
        return (0, len(matches))

    return (n, len(matches))

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recursively replace OpenAI-like API keys (sk-...) with a placeholder."
    )
    parser.add_argument(
        "root",
        nargs="?",
        default=r"C:\Users\juria.koga\Documents\Github\LLM-test-evaluation",
        help="Root directory to scan (default: your LLM-test-evaluation path).",
    )
    parser.add_argument(
        "--placeholder",
        default="API-KEY",
        help="Replacement text (default: API-KEY).",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Do not create .bak backups (default: backups are created).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change, but do not modify files.",
    )
    parser.add_argument(
        "--include",
        action="append",
        default=[],
        help="Only process files whose path contains this substring (can be repeated).",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Add an excluded directory name (can be repeated).",
    )

    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()

    excludes = set(DEFAULT_EXCLUDES)
    excludes.update(args.exclude)

    if not root.exists() or not root.is_dir():
        print(f"ERROR: root directory not found: {root}", file=sys.stderr)
        return 2

    total_files = 0
    changed_files = 0
    total_replacements = 0

    for file_path in iter_files(root, excludes):
        if should_exclude(file_path, root, excludes):
            continue

        if args.include:
            pstr = str(file_path)
            if not any(s in pstr for s in args.include):
                continue

        total_files += 1
        n, before = redact_in_file(
            file_path,
            placeholder=args.placeholder,
            make_backup=not args.no_backup,
            dry_run=args.dry_run,
        )
        if n > 0:
            changed_files += 1
            total_replacements += n
            rel = file_path.relative_to(root)
            mode = "DRY-RUN" if args.dry_run else "UPDATED"
            print(f"[{mode}] {rel}  replacements={n}")

    print("\n--- Summary ---")
    print(f"Scanned files: {total_files}")
    print(f"Changed files: {changed_files}")
    print(f"Total replacements: {total_replacements}")
    if args.dry_run:
        print("No files were modified (dry-run).")
    else:
        if args.no_backup:
            print("No backups were created (--no-backup).")
        else:
            print("Backups were created as *.bak (when not already present).")

    return 0

if __name__ == "__main__":
    raise SystemExit(main())