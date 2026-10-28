#!/usr/bin/python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Pixel measurements on headless shots, for the suite's logo and cover checks.

Usage: imgstat.py sat <png> x0 y0 x1 y1        fraction of strongly colored pixels in the box
       imgstat.py diff <a.png> <b.png> x0 y0 x1 y1   fraction of pixels that differ clearly
"""
import sys
import warnings

from PIL import Image, ImageChops

warnings.simplefilter("ignore")


def crop(path, box):
    return Image.open(path).convert("RGB").crop(box)


op = sys.argv[1]
if op == "sat":
    box = tuple(int(v) for v in sys.argv[3:7])
    px = list(crop(sys.argv[2], box).getdata())
    print(f"{sum(1 for r, g, b in px if max(r, g, b) - min(r, g, b) > 60) / len(px):.3f}")
else:
    box = tuple(int(v) for v in sys.argv[4:8])
    d = ImageChops.difference(crop(sys.argv[2], box), crop(sys.argv[3], box)).convert("L")
    px = list(d.getdata())
    print(f"{sum(1 for v in px if v > 40) / len(px):.3f}")
