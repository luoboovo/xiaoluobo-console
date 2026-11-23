# 用参考图生成弹幕姬「茵茵专属气泡」素材：public/danmaku/bubbles/yinyin.png
# 这张是对称的名牌框：顶上皇冠、底下蝴蝶结在正中，上下两排蕾丝的花纹周期还不一样，横向平铺必然露缝或变形，
# 所以整张原样使用（气泡定义里 fixed: true），大小跟着字号等比缩放，长弹幕在框里自动缩字。
# 改了图要换文件名（PNG 缓存一天），并在 lib/danmaku.cjs 的 RETIRED_IMAGES 里登记旧名字。
# 需要 Pillow：python scripts/build-yinyin-bubble.py
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
src = Image.open(root / 'docs' / 'danmaku-bubbles' / 'yinyin-reference.webp').convert('RGBA')
W, H = src.size  # 2000×667
x0, y0, x1, y1 = src.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
x0, y0, x1, y1 = max(0, x0 - 4), max(0, y0 - 4), min(W, x1 + 4), min(H, y1 + 4)
x1 -= (x1 - x0) % 2; y1 -= (y1 - y0) % 2
out = src.crop((x0, y0, x1, y1))
w, h = out.size
out.resize((w // 2, h // 2), Image.LANCZOS).save(root / 'public' / 'danmaku' / 'bubbles' / 'yinyin.png', optimize=True)
# 文字区：左边让开左上角的星星和左边花纹（x≈330），右边让开发夹和小猫徽章（x≈1660），上边在吊坠下面（y≈250），下边在底下蝴蝶结上面（y≈462），免得两行字压到蝴蝶结。
L, R, T, B = 330, 1660, 250, 462
print(f'size {w // 2}x{h // 2} ratio {w}/{h}')
print(f'box: left {(L - x0) / w * 100:.2f} right {(x1 - R) / w * 100:.2f} top {(T - y0) / h * 100:.2f} bottom {(y1 - B) / h * 100:.2f}')
