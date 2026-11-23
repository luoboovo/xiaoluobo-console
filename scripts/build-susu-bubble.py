# 用参考图生成弹幕姬「诉诉专属气泡」九宫格素材：public/danmaku/bubbles/susu-v2.png
# 左端（狗耳少年 + 爱心）、右端（兔耳小女孩 + 骨头 + 蝴蝶结 + 云）原样保留，中间只留一小段能无缝平铺的气泡，
# 弹幕变长时由 border-image 横向平铺这一段，虚线不会被拉长。狗耳少年按 BOY_SCALE 缩小，贴着气泡尾巴趴着。
# 需要 Pillow：python scripts/build-susu-bubble.py
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
src = Image.open(root / 'docs' / 'danmaku-bubbles' / 'susu-reference.webp').convert('RGBA')
W, H = src.size  # 2000×667

BOY_SCALE = 0.45
# 参考图里的位置：A..B 是虚线相位刚好对齐的三段虚线（平铺段），R 是右端开始的位置（和 B 相位一致），M 是接缝渐变宽度。
A, B, R, M = 866, 994, 1325, 40
RIGHT_END = 1945

# —— 拆图层：少年（含闪光、摇尾巴线）/ 爱心对话泡 / 气泡和右边所有东西 ——
# 少年和气泡左端的分界线（y → x，分界线左边是少年），手工沿着头发尖、气泡尾巴和手臂之间的空隙描的。
SEP = [(0, 652), (312, 652), (316, 668), (345, 669), (385, 657), (415, 646), (440, 606), (462, 604), (478, 618), (492, 640), (512, 660), (540, 690), (556, 700), (H, 700)]
boy_mask = Image.new('L', (W, H), 0)
ImageDraw.Draw(boy_mask).polygon([(0, 0)] + [(x, y) for y, x in SEP] + [(0, H)], fill=255)
heart_box = (652, 130, 792, 306)  # 下边留在气泡上沿之上，免得把气泡描边带过来

def masked(mask):
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0)); out.paste(src, (0, 0), mask); return out

boy = masked(boy_mask)
# 少年脚下那条地平线伸到气泡底下的一截去掉，缩小后不会悬空。
ImageDraw.Draw(boy).rectangle((639, 530, 700, 560), fill=(0, 0, 0, 0))
rest_mask = boy_mask.point(lambda v: 255 - v)
ImageDraw.Draw(rest_mask).rectangle(heart_box, fill=0)
# 原图少年耳朵尖露在爱心下面的一小截（气泡左上角外面），缩小后会悬空，去掉。
ImageDraw.Draw(rest_mask).rectangle((630, 250, 688, 321), fill=0)
ImageDraw.Draw(rest_mask).rectangle((688, 250, 745, 315), fill=0)
rest = masked(rest_mask)
heart = src.crop(heart_box)

# —— 缩小少年：以手臂右下角（贴着气泡尾巴的地方）为锚点等比缩小；爱心同比缩小，放在少年头顶右边 ——
anchor = (640, 548)
bb = boy.getbbox()
small = boy.crop(bb).resize((round((bb[2] - bb[0]) * BOY_SCALE), round((bb[3] - bb[1]) * BOY_SCALE)), Image.LANCZOS)
canvas = rest.copy()
canvas.alpha_composite(small, (round(anchor[0] - (anchor[0] - bb[0]) * BOY_SCALE), round(anchor[1] - (anchor[1] - bb[1]) * BOY_SCALE)))
hs = heart.resize((round(heart.width * BOY_SCALE), round(heart.height * BOY_SCALE)), Image.LANCZOS)
# 爱心贴在少年头顶右上方（原图头顶最高处 y≈125），右边不碰气泡描边。
head_top = round(anchor[1] - (anchor[1] - 125) * BOY_SCALE)
canvas.alpha_composite(hs, (660 - hs.width, head_top + 4 - hs.height))
src = canvas

# —— 九宫格：左端 + 可平铺的中段 + 右端 ——
def blend(base, other):
    """base 和 other 等宽，逐列从 base 渐变到 other。"""
    out = base.copy()
    for j in range(base.width):
        col = Image.blend(base.crop((j, 0, j + 1, base.height)), other.crop((j, 0, j + 1, base.height)), (j + 0.5) / base.width)
        out.paste(col, (j, 0))
    return out

x0 = src.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()[0] - 6
x0 -= (A - x0) % 2  # 左端宽度取偶数，缩小一半后切线还在整像素上
tile = src.crop((A, 0, B, H))
# 平铺段开头从「B 之后的样子」渐变回本来的样子，这样段尾接段头是连续的。
tile.paste(blend(src.crop((B, 0, B + M, H)), src.crop((A, 0, A + M, H))), (0, 0))
left = src.crop((x0, 0, A, H))
# 左端最后一截渐变成「B 之前的样子」，接平铺段开头不露缝。
left.paste(blend(src.crop((A - M, 0, A, H)), src.crop((B - M, 0, B, H))), (left.width - M, 0))
right = src.crop((R, 0, RIGHT_END, H))
# 右端开头从「B 之后的样子」渐变回本来的样子，接平铺段结尾不露缝。
right.paste(blend(src.crop((B, 0, B + M, H)), src.crop((R, 0, R + M, H))), (0, 0))

out = Image.new('RGBA', (left.width + tile.width + right.width, H), (0, 0, 0, 0))
out.alpha_composite(left, (0, 0)); out.alpha_composite(tile, (left.width, 0)); out.alpha_composite(right, (left.width + tile.width, 0))
box = out.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
y0, y1 = max(0, box[1] - 6), min(H, box[3] + 6)
y1 += (y1 - y0) % 2
out = out.crop((0, y0, out.width, y1))
w, h = out.size
# 缩到一半（各段宽度都是偶数，缩完切线仍落在整像素上），直播画面里足够清楚，文件小很多。
out.resize((w // 2, h // 2), Image.LANCZOS).save(root / 'public' / 'danmaku' / 'bubbles' / 'susu-v2.png', optimize=True)
# 文字只放在虚线框里面：上下按参考图里虚线内侧（y≈352 / 522），左边从气泡尾巴后面（x≈700），右边到爪印前面（x≈1570）。
text_left, text_right = 700 - x0, left.width + tile.width + (1570 - R)
print(f'size {w // 2}x{h // 2} ratio {w}/{h}')
print(f"cap: left {left.width / w * 100:.2f} right {right.width / w * 100:.2f}")
print(f"box: left {text_left / w * 100:.2f} right {(w - text_right) / w * 100:.2f} top {(352 - y0) / h * 100:.2f} bottom {(y1 - 522) / h * 100:.2f}")
