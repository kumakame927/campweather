"""Require files derived from the supplied design; never generate replacements."""
from pathlib import Path
from PIL import Image
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180), ('favicon-32.png', 32)]:
    path = Path('public/icons') / name
    if not path.exists():
        raise SystemExit('未完了：指定アイコンの元画像ファイルが必要です。未提供のため代替画像は生成していません。')
    with Image.open(path) as image:
        assert image.format == 'PNG' and image.size == (size, size), (name, image.size)
        assert image.getbbox(), name
    print('PASS', name, size, size, path.stat().st_size, 'bytes')
