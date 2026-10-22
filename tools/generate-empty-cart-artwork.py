"""Generate original Frescopa empty-cart artwork with transparent backgrounds.

Requires Pillow. Run from any directory:
    python3 tools/generate-empty-cart-artwork.py

The cart rolls in once (under three seconds), then rests on the same frame as the
reduced-motion PNG. Both assets use the existing cart illustration's aspect ratio.
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw


SIZE = (370, 320)
SCALE = 3
BURGUNDY = "#58181d"
TEAL = "#00647d"
ICONS = Path(__file__).resolve().parents[1] / "icons"


def curve(points):
    """Sample a cubic Bezier for Pillow's antialiased line drawing."""
    result = []
    for step in range(61):
        t = step / 60
        result.append(tuple(
            (1 - t) ** 3 * points[0][axis]
            + 3 * (1 - t) ** 2 * t * points[1][axis]
            + 3 * (1 - t) * t ** 2 * points[2][axis]
            + t ** 3 * points[3][axis]
            for axis in (0, 1)
        ))
    return result


def frame(offset=0):
    image = Image.new("RGBA", (SIZE[0] * SCALE, SIZE[1] * SCALE))
    draw = ImageDraw.Draw(image)

    def line(points, fill=BURGUNDY, width=5):
        scaled = [(round((x + offset) * SCALE), round(y * SCALE)) for x, y in points]
        draw.line(scaled, fill=fill, width=width * SCALE, joint="curve")
        radius = width * SCALE / 2
        for x, y in (scaled[0], scaled[-1]):
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)

    draw.ellipse(
        ((120 + offset) * SCALE, 253 * SCALE, (279 + offset) * SCALE, 263 * SCALE),
        fill=(88, 24, 29, 14),
    )
    chassis = [(70, 87), (94, 87)]
    chassis += curve([(94, 87), (101, 87), (104, 92), (106, 100)])
    chassis += [(132, 198)]
    chassis += curve([(132, 198), (134, 205), (138, 207), (146, 207)])
    chassis += [(267, 207)]
    line(chassis)
    basket = [(111, 116), (284, 116)]
    basket += curve([(284, 116), (293, 116), (295, 121), (292, 130)])
    basket += [(278, 174)]
    basket += curve([(278, 174), (276, 182), (272, 185), (264, 185)])
    basket += [(130, 185)]
    line(basket)
    for top, bottom in ((157, 163), (202, 202), (247, 241)):
        line([(top, 134), (bottom, 167)], fill=(88, 24, 29, 140), width=3)
    line([(70, 87), (88, 87)], fill=TEAL, width=7)
    for center in (151, 253):
        draw.ellipse(
            ((center - 11 + offset) * SCALE, 218 * SCALE,
             (center + 11 + offset) * SCALE, 240 * SCALE),
            outline=BURGUNDY,
            width=5 * SCALE,
        )
        angle = offset / 11
        line(
            [(center, 229),
             (center + 6 * math.sin(angle), 229 - 6 * math.cos(angle))],
            fill=TEAL,
            width=3,
        )
    return image.resize(SIZE, Image.Resampling.LANCZOS)


def on_white(artwork):
    background = Image.new("RGB", SIZE, "white")
    background.paste(artwork, mask=artwork.getchannel("A"))
    return background


def main():
    still = frame()
    still.save(ICONS / "empty-cart-trolley.png", optimize=True)
    palette = on_white(still).quantize(colors=64)
    frames = []
    for index in range(25):
        progress = index / 24
        artwork = frame(-28 * (1 - progress) ** 3)
        quantized = on_white(artwork).quantize(palette=palette, dither=Image.Dither.NONE)
        # GIF has binary transparency; antialiased edges are matted for the white cart panel.
        transparent_mask = artwork.getchannel("A").point(lambda alpha: 255 if alpha == 0 else 0)
        quantized.paste(255, mask=transparent_mask)
        frames.append(quantized)
    frames[0].save(
        ICONS / "empty-cart-trolley.gif",
        save_all=True,
        append_images=frames[1:],
        duration=80,
        optimize=False,
        disposal=2,
        transparency=255,
        background=255,
    )


if __name__ == "__main__":
    main()
