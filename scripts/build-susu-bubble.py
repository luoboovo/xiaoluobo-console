# 用参考图生成弹幕姬「诉诉专属气泡」九宫格素材：public/danmaku/bubbles/susu.png
# 左端（狗耳少年 + 爱心）、右端（兔耳小女孩 + 骨头 + 蝴蝶结 + 云）原样保留，中间只留一小段能无缝平铺的气泡，
# 弹幕变长时由 border-image 横向平铺这一段，虚线不会被拉长。需要 Pillow：python scripts/build-susu-bubble.py
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
src = Image.open(root / 'docs' / 'danmaku-bubbles' / 'susu-reference.webp').convert('RGBA')

# 参考图里的位置（2000×667）：a..b 是虚线相位刚好对齐的三段虚线，R 是右端开始的位置（和 b 相位一致）。
A, B, R, M = 866, 994, 1325, 40
x0, x1 = 60, 1945  # 左右留一点边，闪光和云都在里面

def blend(base, other, ramp_up):
    """base 和 other 等宽，逐列从一个渐变到另一个（ramp_up=True: base→other）。"""
    out = base.copy()
    w = base.width
    for j in range(w):
        t = (j + 0.5) / w
        if not ramp_up: t = 1 - t
        col = Image.blend(base.crop((j, 0, j + 1, base.height)), other.crop((j, 0, j + 1, base.height)), t)
        out.paste(col, (j, 0))
    return out

H = src.height
tile = src.crop((A, 0, B, H))
# 平铺段开头从「B 之后的样子」渐变回本来的样子，这样段尾接段头是连续的。
tile.paste(blend(src.crop((B, 0, B + M, H)), src.crop((A, 0, A + M, H)), True), (0, 0))
left = src.crop((x0, 0, A, H))
# 左端最后一截渐变成「B 之前的样子」，接平铺段开头不露缝。
left.paste(blend(src.crop((A - M, 0, A, H)), src.crop((B - M, 0, B, H)), True), (left.width - M, 0))
right = src.crop((R, 0, x1, H))
# 右端开头从「B 之后的样子」渐变回本来的样子，接平铺段结尾不露缝。
right.paste(blend(src.crop((B, 0, B + M, H)), src.crop((R, 0, R + M, H)), True), (0, 0))

out = Image.new('RGBA', (left.width + tile.width + right.width, H), (0, 0, 0, 0))
out.alpha_composite(left, (0, 0)); out.alpha_composite(tile, (left.width, 0)); out.alpha_composite(right, (left.width + tile.width, 0))
box = out.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
y0, y1 = max(0, box[1] - 6), min(H, box[3] + 6)
out = out.crop((0, y0, out.width, y1))
# 缩到一半（各段宽度都是偶数，缩完切线仍落在整像素上），直播画面里足够清楚，文件小很多。
out = out.resize((out.width // 2, (y1 - y0) // 2), Image.LANCZOS)
out.save(root / 'public' / 'danmaku' / 'bubbles' / 'susu.png', optimize=True)
w, h = out.width * 2, y1 - y0  # 缩小前的尺寸，百分比不受缩放影响
# 文字只放在虚线框里面：上下按参考图里虚线内侧（y≈352 / 522）算。
print(f'size {w}x{h} ratio {w / h:.4f}')
print(f'left {left.width / w * 100:.2f} right {right.width / w * 100:.2f} top {(352 - y0) / h * 100:.2f} bottom {(y1 - 522) / h * 100:.2f}')
