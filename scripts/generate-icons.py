from PIL import Image

BG = (255, 250, 247, 255)
SOURCE = "icon-192.png"


def extract_logo_square(src_img):
    pixels = src_img.load()
    w, h = src_img.size
    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a > 10 and (r > 20 or g > 20 or b > 20):
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    cx = (minx + maxx) // 2
    cy = (miny + maxy) // 2
    side = max(maxx - minx + 1, maxy - miny + 1)
    side = int(side * 1.05)
    left = max(0, cx - side // 2)
    top = max(0, cy - side // 2)
    right = min(w, left + side)
    bottom = min(h, top + side)
    left = max(0, right - side)
    top = max(0, bottom - side)
    return src_img.crop((left, top, right, bottom))


def render_icon(logo, size, fill_ratio, path):
    target = int(round(size * fill_ratio))
    scaled = logo.resize((target, target), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BG)
    offset = ((size - target) // 2, (size - target) // 2)
    canvas.paste(scaled, offset, scaled)
    canvas.convert("RGB").save(path, format="PNG", optimize=True)


if __name__ == "__main__":
    src = Image.open(SOURCE).convert("RGBA")
    logo = extract_logo_square(src)
    render_icon(logo, 192, 0.85, "icon-192.png")
    render_icon(logo, 512, 0.85, "icon-512.png")
    render_icon(logo, 512, 0.72, "icon-maskable-512.png")
    print("Generated icon-192.png, icon-512.png, icon-maskable-512.png")
