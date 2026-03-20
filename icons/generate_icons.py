"""
Generates simple PNG icons for the Chrome extension.
Run: python3 generate_icons.py
Requires: Pillow  (pip install pillow)
"""
import os

try:
    from PIL import Image, ImageDraw, ImageFont
    USE_PILLOW = True
except ImportError:
    USE_PILLOW = False

import struct, zlib

def create_png(size):
    """Create a minimal car-icon PNG using raw bytes (no dependencies)."""
    # RGBA canvas — blue background, white 'C' letter
    width = height = size
    pixels = []
    cx, cy, r = width // 2, height // 2, width // 2 - 2

    for y in range(height):
        row = []
        for x in range(width):
            # Rounded blue background
            dx, dy = x - cx, y - cy
            if dx * dx + dy * dy <= r * r:
                # Simple 'C' letter mask
                inner = (dx * dx + dy * dy) < (r * 0.45) ** 2
                right_cut = x > cx + r * 0.3 and abs(dy) < r * 0.5
                if not inner and not right_cut:
                    row.extend([0, 87, 184, 255])   # blue
                else:
                    row.extend([255, 255, 255, 255]) # white
            else:
                row.extend([0, 0, 0, 0])  # transparent
        pixels.extend(row)

    raw = b''.join(
        b'\x00' + bytes(pixels[y * width * 4:(y + 1) * width * 4])
        for y in range(height)
    )

    def png_chunk(name, data):
        c = struct.pack('>I', len(data)) + name + data
        return c + struct.pack('>I', zlib.crc32(name + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    compressed = zlib.compress(raw)

    return (b'\x89PNG\r\n\x1a\n' +
            png_chunk(b'IHDR', ihdr) +
            png_chunk(b'IDAT', compressed) +
            png_chunk(b'IEND', b''))


sizes = [16, 48, 128]
script_dir = os.path.dirname(os.path.abspath(__file__))

for sz in sizes:
    out = os.path.join(script_dir, f'icon{sz}.png')
    with open(out, 'wb') as f:
        f.write(create_png(sz))
    print(f'Created {out}')
