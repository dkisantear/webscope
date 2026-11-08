"""Copy ui/ into the sketch's data/ folder so it can be uploaded to the ESP32's LittleFS.
Run from the repo root:  python tools/sync_ui.py
ui/ stays the only source; data/ is a generated copy (gitignored)."""
import shutil
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src, dst = root / "ui", root / "firmware" / "webscope_esp32" / "data"
shutil.rmtree(dst, ignore_errors=True)
shutil.copytree(src, dst, ignore=shutil.ignore_patterns("README*", ".gitkeep", ".DS_Store"))
print(f"Copied {sum(1 for p in dst.rglob('*') if p.is_file())} files to {dst.relative_to(root)}")
