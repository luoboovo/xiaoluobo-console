# 用参考图生成弹幕姬「茵茵气泡2」九宫格素材：public/danmaku/bubbles/yinyin2-v2.png
# 左端（茵茵头像框 + 左边的爱心和星星）、右端（发夹、星星、爱心、小猫徽章）原样保留，中间只留两个蕾丝花纹周期，
# 弹幕变长时由 border-image 横向平铺这一段，蕾丝不会被拉长变形（和诉诉专属气泡一样 tile: true）。
# 改了图要换文件名（PNG 缓存一天），并在 lib/danmaku.cjs 的 RETIRED_IMAGES 里登记旧名字。
# 需要 Pillow：python scripts/build-yinyin2-bubble.py
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
src = Image.open(root / 'docs' / 'danmaku-bubbles' / 'yinyin2-reference.webp').convert('RGBA')
W, H = src.size  # 2000×666

# 上下两排蕾丝的花纹周期都是 ≈118.5px。A..B 是平铺段（两个周期），R 是右端开始的位置（和 B 相位一致），M 是接缝渐变宽度。
PERIOD = 118.5
A = 800
B = A + 2 * round(PERIOD)            # 1037
R = round(A + 7 * PERIOD)            # 1630，右下爱心左边
M = 30

def blend(base, other):
    """base 和 other 等宽，逐列从 base 渐变到 other。"""
    out = base.copy()
    for j in range(base.width):
        col = Image.blend(base.crop((j, 0, j + 1, base.height)), other.crop((j, 0, j + 1, base.height)), (j + 0.5) / base.width)
        out.paste(col, (j, 0))
    return out

x0, y0, x1, y1 = src.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
x0, y0, x1, y1 = max(0, x0 - 4), max(0, y0 - 4), min(W, x1 + 4), min(H, y1 + 4)
x0 -= (A - x0) % 2          # 左端宽度取偶数，缩小一半后切线还在整像素上
x1 += (x1 - R) % 2          # 右端宽度取偶数
y1 += (y1 - y0) % 2

tile = src.crop((A, 0, B, H))
# 平铺段开头从「B 之后的样子」渐变回本来的样子，这样段尾接段头是连续的。
tile.paste(blend(src.crop((B, 0, B + M, H)), src.crop((A, 0, A + M, H))), (0, 0))
left = src.crop((x0, 0, A, H))
# 左端最后一截渐变成「B 之前的样子」，接平铺段开头不露缝。
left.paste(blend(src.crop((A - M, 0, A, H)), src.crop((B - M, 0, B, H))), (left.width - M, 0))
right = src.crop((R, 0, x1, H))
# 右端开头从「B 之后的样子」渐变回本来的样子，接平铺段结尾不露缝。
right.paste(blend(src.crop((B, 0, B + M, H)), src.crop((R, 0, R + M, H))), (0, 0))

out = Image.new('RGBA', (left.width + tile.width + right.width, H), (0, 0, 0, 0))
out.alpha_composite(left, (0, 0)); out.alpha_composite(tile, (left.width, 0)); out.alpha_composite(right, (left.width + tile.width, 0))
out = out.crop((0, y0, out.width, y1))
w, h = out.size
out.resize((w // 2, h // 2), Image.LANCZOS).save(root / 'public' / 'danmaku' / 'bubbles' / 'yinyin2-v2.png', optimize=True)
# 文字区：左边让开左边的爱心和两颗星星（x≈770），右边让开右边的星星（x≈1760），
# 上边在上排蕾丝下面（y≈215），下边在下排蕾丝和右下爱心、小猫上面（y≈470）。
L, RT, T, BT = 770, 1760, 215, 470
text_left, text_right = L - x0, left.width + tile.width + (RT - R)
print(f'size {w // 2}x{h // 2} ratio {w}/{h}')
print(f'cap: left {left.width / w * 100:.2f} right {right.width / w * 100:.2f}')
print(f'box: left {text_left / w * 100:.2f} right {(w - text_right) / w * 100:.2f} top {(T - y0) / h * 100:.2f} bottom {(y1 - BT) / h * 100:.2f}')
