#!/usr/bin/env python3
"""アイコン PNG を生成する。図形はすべて自作で、外部素材は使っていない。

    python3 tools/make-icons.py
"""
from PIL import Image, ImageDraw

BG = (79, 70, 229, 255)          # 背景の角丸四角（indigo）
LINE = (255, 255, 255, 255)      # 幹（縦線）と枝
SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 8


def render(size):
    s = size * SUPERSAMPLE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=BG)

    w = max(int(s * 0.07), 1)          # 線の太さ
    x0 = s * 0.30                      # 幹の x 位置
    top = s * 0.22
    rows = (s * 0.32, s * 0.52, s * 0.72)   # 枝の y 位置（3 本）
    branch_len = s * 0.36
    r = w // 2

    # 幹: 上端から最後の枝まで
    d.rounded_rectangle((x0 - r, top, x0 + r, rows[-1] + r), radius=r, fill=LINE)
    # 枝: 幹から右へ
    for y in rows:
        d.rounded_rectangle((x0, y - r, x0 + branch_len, y + r), radius=r, fill=LINE)

    return img.resize((size, size), Image.LANCZOS)


for size in SIZES:
    path = f"icons/icon{size}.png"
    render(size).save(path)
    print(f"wrote {path}")
