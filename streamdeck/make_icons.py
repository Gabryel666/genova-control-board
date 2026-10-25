#!/usr/bin/env python3
"""Generate the plugin's icons (idempotent, no external assets).

Run from the repository root: `npm run icons`.
Stream Deck expects 1x/@2x pairs; the board itself never uses these files at
runtime (keys are drawn as SVG), they only brand the plugin in the app.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SD = ROOT / "imgs"

BG = (21, 21, 29, 255)
BORDEAUX = (122, 26, 44, 255)
LIGHT = (244, 244, 245, 255)
GREY = (156, 163, 175, 255)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FALLBACK = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in (FONT_BOLD, FALLBACK):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def tile(size: int, glyph: str, accent: tuple[int, int, int, int] = BORDEAUX,
         glyph_color: tuple[int, int, int, int] = LIGHT) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = max(4, size // 8)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BG)

    # Left accent bar, same visual language as the keys.
    bar = max(3, size // 24)
    draw.rounded_rectangle((0, 0, bar * 2, size - 1), radius=radius, fill=accent)

    f = font(int(size * 0.5))
    box = draw.textbbox((0, 0), glyph, font=f)
    x = (size - (box[2] - box[0])) / 2 + bar
    y = (size - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), glyph, font=f, fill=glyph_color)
    return img


def write_pair(path: Path, size: int, glyph: str, **kwargs) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tile(size, glyph, **kwargs).save(path.with_suffix(".png"))
    tile(size * 2, glyph, **kwargs).save(path.with_name(path.name + "@2x.png"))


def main() -> None:
    write_pair(SD / "plugin" / "marketplace", 144, "G")
    write_pair(SD / "plugin" / "category-icon", 28, "G", glyph_color=GREY)
    write_pair(SD / "actions" / "status" / "icon", 20, "⏻")
    write_pair(SD / "actions" / "status" / "key", 72, "⏻")
    write_pair(SD / "actions" / "model" / "icon", 20, "M", accent=(59, 130, 246, 255))
    write_pair(SD / "actions" / "model" / "key", 72, "M", accent=(59, 130, 246, 255))
    write_pair(SD / "actions" / "cron" / "icon", 20, "C", accent=(34, 197, 94, 255))
    write_pair(SD / "actions" / "cron" / "key", 72, "C", accent=(34, 197, 94, 255))
    write_pair(SD / "actions" / "metric" / "icon", 20, "%", accent=(249, 115, 22, 255))
    write_pair(SD / "actions" / "metric" / "key", 72, "%", accent=(249, 115, 22, 255))
    print(f"icônes écrites dans {SD}")


if __name__ == "__main__":
    main()
