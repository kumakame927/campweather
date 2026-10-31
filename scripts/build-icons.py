"""Resize the supplied artwork deterministically; no generation or redrawing.
Requires Pillow only when regenerating the committed PNG files.
"""
from pathlib import Path
from PIL import Image, ImageChops

root = Path(__file__).resolve().parents[1]
source = root / 'public/harecamp-icon-source.png'
if not source.is_file():
    raise SystemExit('指定の元画像 public/harecamp-icon-source.png が必要です。別デザインは生成しません。')
with Image.open(source) as image:
    image.load()
    if image.width < 512 or image.height < 512:
        raise SystemExit('元画像は512px以上の幅・高さが必要です。')
    original = image.convert('RGB')
# Trim only the white surround, with a safety margin. Preserve every part of the
# supplied illustration, its aspect ratio and its original white background.
difference = ImageChops.difference(original, Image.new('RGB', original.size, 'white')).convert('L')
box = difference.point(lambda value: 255 if value > 20 else 0).getbbox()
if not box:
    raise SystemExit('元画像を確認できません。')
padding = round(max(box[2] - box[0], box[3] - box[1]) * .02)
box = (max(0, box[0] - padding), max(0, box[1] - padding), min(original.width, box[2] + padding), min(original.height, box[3] + padding))
art = original.crop(box)
side = max(art.size)
square = Image.new('RGB', (side, side), 'white')
square.paste(art, ((side - art.width) // 2, (side - art.height) // 2))
output = root / 'public/icons'
output.mkdir(parents=True, exist_ok=True)
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180), ('favicon-32.png', 32)]:
    path = output / name
    square.resize((size, size), Image.Resampling.LANCZOS).save(path, format='PNG', optimize=True)
    print(name, f'{size}x{size}', path.stat().st_size, 'bytes')
