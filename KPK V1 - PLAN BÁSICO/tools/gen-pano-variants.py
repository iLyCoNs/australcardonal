#!/usr/bin/env python3
"""Generate mobile-safe equirectangular variants (no browser JS downscale)."""
from __future__ import annotations

import os
import sys

try:
    from PIL import Image
except ImportError:
    print("Installing Pillow…")
    os.system(f'"{sys.executable}" -m pip install Pillow -q')
    from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "loteo360.jpg")

VARIANTS = [
    (4096, "loteo360-4096.jpg", 85),
    (2048, "loteo360-2048.jpg", 82),
]


def main() -> None:
    if not os.path.isfile(SRC):
        raise SystemExit(f"Missing {SRC}")
    img = Image.open(SRC)
    print("original", img.size, os.path.getsize(SRC))
    for width, name, quality in VARIANTS:
        out_path = os.path.join(ROOT, name)
        height = int(round(img.height * (width / float(img.width))))
        out = img.resize((width, height), Image.Resampling.LANCZOS)
        out.save(out_path, "JPEG", quality=quality, optimize=True, progressive=False)
        print("wrote", name, out.size, os.path.getsize(out_path))


if __name__ == "__main__":
    main()
