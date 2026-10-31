"""Resize the full-bleed square master without padding, masks or corner rounding.
Requires Pillow only when regenerating the committed PNG files.
"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'public/harecamp-icon-source.png'
if not source.is_file():
    raise SystemExit('元画像 public/harecamp-icon-source.png が必要です。')
with Image.open(source) as image:
    image.load()
    if image.width != image.height or image.width < 512:
        raise SystemExit('背景が端まで描かれた512px以上の正方形の元画像が必要です。余白は追加しません。')
    if image.convert('RGBA').getchannel('A').getextrema() != (255, 255):
        raise SystemExit('元画像に透明部分があります。背景を端まで描画してください。')
    original = image.convert('RGB')
    width, height = original.size
    for x, y in [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]:
        if min(original.getpixel((x, y))) >= 240:
            raise SystemExit('元画像の四隅に白い余白があります。背景を端まで描画してください。')
output = root / 'public/icons'
output.mkdir(parents=True, exist_ok=True)
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180), ('favicon-32.png', 32)]:
    path = output / name
    original.resize((size, size), Image.Resampling.LANCZOS).save(path, format='PNG', optimize=True)
    print(name, f'{size}x{size}', path.stat().st_size, 'bytes')
