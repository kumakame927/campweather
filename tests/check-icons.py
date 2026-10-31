"""Check delivered icons for dimensions, opacity and accidental white frames."""
from pathlib import Path
from PIL import Image


def check_full_bleed(path, size=None):
    with Image.open(path) as image:
        assert image.format == 'PNG', path
        width, height = image.size
        assert width == height and (size is None or width == size), (path, image.size)
        assert image.convert('RGBA').getchannel('A').getextrema() == (255, 255), f'{path}: transparent pixels'
        rgb = image.convert('RGB')
        # Clouds inside the illustration are legitimate white; a white outer
        # frame or pre-rounded white corners are not. Check each corner patch.
        patch = max(1, width // 32)
        for left, top in [(0, 0), (width - patch, 0), (0, height - patch), (width - patch, height - patch)]:
            pixels = [rgb.getpixel((x, y)) for y in range(top, top + patch) for x in range(left, left + patch)]
            assert all(min(pixel) < 240 for pixel in pixels), f'{path}: white rounded corner/padding'
        borders = [[rgb.getpixel((x, y)) for x in range(width)] for y in [0, height - 1]]
        borders += [[rgb.getpixel((x, y)) for y in range(height)] for x in [0, width - 1]]
        for edge in borders:
            assert sum(min(pixel) >= 240 for pixel in edge) / len(edge) < .5, f'{path}: white edge/frame'
    print('PASS', path.name, f'{width}x{height}', 'opaque; colored corners/edges; no white frame')

check_full_bleed(Path('public/harecamp-icon-source.png'))
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180), ('favicon-32.png', 32)]:
    check_full_bleed(Path('public/icons') / name, size)
