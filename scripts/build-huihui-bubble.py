# 用头像图生成弹幕姬「绘绘的专属气泡」九宫格素材：public/danmaku/bubbles/huihui.png
# 头像从背景里抠出来（脸和头发，去掉天空和脖子），左端人物和蝴蝶结、右端蝴蝶结和爱心原样保留，中间只留四个花边周期，
# 弹幕变长时由 border-image 横向平铺这一段（tile: true），头像和装饰不变形。
# 改了图要换文件名（PNG 缓存一天），并在 lib/danmaku.cjs 的 RETIRED_IMAGES 里登记旧名字。
# 需要 Pillow：python scripts/build-huihui-bubble.py
import math
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

root = Path(__file__).resolve().parent.parent
face = Image.open(root / 'docs' / 'danmaku-bubbles' / 'huihui-reference.webp').convert('RGB')

S = 4                       # 先按 4 倍画，最后缩小
W, H = 520, 276
PERIOD = 20
L, R = 310, 390             # 左端到 L、右端从 R 开始，中间四个花边周期
GOLD, GOLD_DARK, WHITE = (255, 200, 87), (232, 160, 50), (255, 255, 255)
BLUE, BLUE_DARK, PINK, PINK_DARK = (139, 178, 245), (84, 124, 208), (255, 141, 182), (222, 92, 142)

def s(*v):
    return [x * S for x in v]

def layer():
    return Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))

def rr_mask(box, r):
    m = Image.new('L', (W * S, H * S), 0)
    ImageDraw.Draw(m).rounded_rectangle(s(*box), r * S, fill=255)
    return m

def bezier(p0, p1, p2, p3, n=40):
    out = []
    for i in range(n + 1):
        t = i / n
        k = ((1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3)
        out.append(tuple(sum(c * p[j] for c, p in zip(k, (p0, p1, p2, p3))) for j in (0, 1)))
    return out

def shape(d, pts, fill, line, width, place):
    q = [place(p) for p in pts]
    d.polygon(q, fill=fill)
    d.line(q + [q[0], q[1]], fill=line, width=max(1, round(width * S)), joint='curve')

def sticker(img, draw, border=3):
    """画一个装饰，外面包一圈白边和淡淡的蓝影，像贴纸。"""
    art = layer()
    draw(ImageDraw.Draw(art))
    grow = art.getchannel('A').filter(ImageFilter.MaxFilter(border * S * 2 + 1)).filter(ImageFilter.GaussianBlur(S * .6))
    halo, shadow = layer(), layer()
    halo.paste((*WHITE, 255), mask=grow)
    shadow.paste((70, 110, 180, 90), mask=grow.filter(ImageFilter.GaussianBlur(S * 1.6)))
    img.alpha_composite(shadow, (0, S))
    img.alpha_composite(halo)
    img.alpha_composite(art)

def bow(cx, cy, k, tilt=0, fill=BLUE, dark=BLUE_DARK):
    ca, sa = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))
    light = tuple(min(255, c + 45) for c in fill)
    def draw(d):
        for m in (-1, 1):
            def put(p, m=m):
                return ((cx + (p[0] * m * ca - p[1] * sa) * k) * S, (cy + (p[0] * m * sa + p[1] * ca) * k) * S)
            shape(d, [(2, 4), (16, 30), (21, 23), (29, 26), (12, 3)], fill, dark, 1.6, put)
            loop = bezier((2, -4), (10, -20), (30, -26), (36, -18)) + bezier((36, -18), (40, -6), (38, 8), (34, 14)) + bezier((34, 14), (24, 16), (10, 10), (2, 4))
            shape(d, loop, light, dark, 1.6, put)
            shape(d, bezier((4, 1), (14, -6), (24, -8), (30, -5)) + bezier((30, -5), (24, 0), (14, 4), (4, 2)), fill, fill, .2, put)
        d.rounded_rectangle(s(cx - 7 * k, cy - 8 * k, cx + 7 * k, cy + 8 * k), 5 * k * S, fill=fill, outline=dark, width=round(1.6 * S))
        d.ellipse(s(cx - 4 * k, cy - 5 * k, cx - k, cy - 2 * k), fill=(*WHITE, 255))
    return draw

def heart(cx, cy, k, fill, dark):
    def draw(d):
        def put(p):
            return ((cx + p[0] * k) * S, (cy + p[1] * k) * S)
        half = bezier((0, -5), (4, -14), (16, -13), (15, -2)) + bezier((15, -2), (14, 5), (6, 9), (0, 14))
        shape(d, half + [(-x, y) for x, y in reversed(half)], fill, dark, 1.4, put)
        d.ellipse(s(cx - 10 * k, cy - 8 * k, cx - 5 * k, cy - 3 * k), fill=(*WHITE, 255))
    return draw

def star(d, cx, cy, r, fill):
    pts = []
    for i in range(96):
        a = math.tau * i / 96
        q = abs(math.cos(a)) ** (2 / 3) + abs(math.sin(a)) ** (2 / 3)
        pts.append(((cx + r * math.cos(a) / q ** 1.5) * S, (cy + r * math.sin(a) / q ** 1.5) * S))
    d.polygon(pts, fill=fill)

img = layer()
# —— 气泡身体：外圈金黄、里圈白，底色从天蓝过渡到奶油白，内侧一圈天蓝花边 ——
body, rad = (32, 28, 508, 250), 92
def inset(box, n):
    return (box[0] + n, box[1] + n, box[2] - n, box[3] - n)

shadow = layer()
shadow.paste((90, 130, 190, 110), mask=rr_mask(body, rad).filter(ImageFilter.GaussianBlur(S * 3)))
img.alpha_composite(shadow, (0, 3 * S))
for n, c in ((0, GOLD_DARK), (1.5, GOLD), (6.5, WHITE)):
    img.paste((*c, 255), mask=rr_mask(inset(body, n), rad - n))
fill = Image.new('RGBA', (1, H * S))
for y in range(H * S):
    t = min(1, abs(y / S - 139) / 100) ** 2
    fill.putpixel((0, y), (*[round(a + (b - a) * t) for a, b in zip((255, 253, 246), (232, 246, 255))], 255))
inner, ir = inset(body, 9.5), rad - 9.5
img.paste(fill.resize((W * S, H * S)), mask=rr_mask(inner, ir))
x0, y0, x1, y1 = inner
dots = []
for x in range(150, int(x1 - ir) + 1, PERIOD):
    dots += [(x, y0), (x, y1)]
last = max(p[0] for p in dots)
# 转角弧线上接着排花边，间距差不多。
head, q, flat = x1 - ir - last, math.pi * ir / 2, y1 - y0 - 2 * ir
total = 2 * head + 2 * q + flat
n = round(total / PERIOD)
for i in range(1, n):
    t = i / n * total - head
    if t < 0: p = (x1 - ir + t, y0)
    elif t < q: p = (x1 - ir + ir * math.sin(t / ir), y0 + ir - ir * math.cos(t / ir))
    elif t < q + flat: p = (x1, y0 + ir + t - q)
    elif t < 2 * q + flat: p = (x1 - ir + ir * math.cos((t - q - flat) / ir), y1 - ir + ir * math.sin((t - q - flat) / ir))
    else: p = (x1 - ir - (t - 2 * q - flat), y1)
    dots.append(p)
dots += [(body[0] + body[2] - x, y) for x, y in dots]      # 左边对称
lace = layer()
d = ImageDraw.Draw(lace)
for r, c in ((11, (190, 222, 250, 255)), (9.2, (214, 236, 254, 255))):
    for x, y in dots: d.ellipse(s(x - r, y - r, x + r, y + r), fill=c)
clip = layer()
clip.paste(lace, mask=rr_mask(inner, ir))
img.alpha_composite(clip)

# —— 抠图：K 倍坐标里沿头发和下巴描一圈，两侧发梢再按颜色去掉天空 ——
K = 4
def smooth(pts, n=12):
    out = []
    for i in range(len(pts)):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % len(pts)], pts[(i + 2) % len(pts)]
        for j in range(n):
            t = j / n
            out.append(tuple(.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t ** 3) for k in (0, 1)))
    return out
HULL = [(516, 2), (700, 14), (850, 78), (960, 190), (1016, 340), (1030, 500), (1030, 640), (985, 725), (945, 745),
        (935, 820), (925, 900), (895, 985), (862, 925), (838, 860), (826, 800), (765, 838), (700, 872), (625, 907), (510, 942),
        (395, 911), (330, 887), (255, 842), (205, 800), (198, 860), (188, 930), (150, 985), (108, 900), (100, 820), (88, 760),
        (50, 730), (2, 650), (2, 500), (16, 340), (72, 190), (182, 78), (332, 14)]
big = face.resize((face.width * K, face.height * K), Image.LANCZOS)
mask = Image.new('L', big.size, 0)
ImageDraw.Draw(mask).polygon(smooth(HULL), fill=255)
red, _, blue = big.filter(ImageFilter.GaussianBlur(1.5)).split()
warm = ImageChops.subtract(red, blue).point(lambda v: 255 if v > 8 else 0)
ImageDraw.Draw(warm).rectangle((0, 0, big.width, 610), fill=255)
ImageDraw.Draw(warm).rectangle((200, 0, 830, big.height), fill=255)
mask = ImageChops.darker(mask, warm).filter(ImageFilter.MedianFilter(9)).filter(ImageFilter.GaussianBlur(3)).point(lambda v: max(0, min(255, (v - 110) * 5)))
big.putalpha(mask)
HX, HY, HW = 12, 9, 238                                  # 抠好的人物放在气泡左端，头顶冒出气泡一点
hs = HW * S / big.width
head = big.resize((HW * S, round(big.height * hs)), Image.LANCZOS)
pic = layer()
pic.paste(head, (HX * S, HY * S))
grow = pic.getchannel('A').filter(ImageFilter.MaxFilter(4 * S * 2 + 1)).filter(ImageFilter.GaussianBlur(S * 1.4)).point(lambda v: max(0, min(255, (v - 100) * 5)))
shadow, halo = layer(), layer()
shadow.paste((80, 110, 180, 130), mask=grow.filter(ImageFilter.GaussianBlur(S * 2.2)))
halo.paste((*WHITE, 255), mask=grow)
img.alpha_composite(shadow, (S, 2 * S))
img.alpha_composite(halo)
img.alpha_composite(pic)

# —— 装饰：头发上的蝴蝶结（原图的被图边切掉了一点，补成完整的）、下巴下面的蝴蝶结、一蓝一粉两颗爱心（异色瞳）、右上角蝴蝶结、星星 ——
sticker(img, bow(131, 240, .82))
sticker(img, bow(229, 62, .74, 10), 2)
sticker(img, heart(84, 244, .8, BLUE, BLUE_DARK))
sticker(img, heart(178, 244, .8, PINK, PINK_DARK))
sticker(img, bow(466, 42, .92, 14))
sticker(img, heart(452, 238, .9, BLUE, BLUE_DARK))
sticker(img, heart(482, 218, 1.1, PINK, PINK_DARK))
def corner_stars(d):
    star(d, 24, 34, 13, (*GOLD, 255))
    star(d, 42, 16, 7, (*PINK, 255))
def end_stars(d):
    star(d, 476, 108, 12, (*GOLD, 255))
    star(d, 486, 130, 7, (*PINK, 255))
sticker(img, corner_stars, 2)
sticker(img, end_stars, 1)

out = img.resize((W, H), Image.LANCZOS)
# 平铺段每一列都严格按花边周期重复，接缝看不出来。
cell = out.crop((L + PERIOD, 0, L + 2 * PERIOD, H))
for x in range(L - PERIOD, R + PERIOD, PERIOD):
    out.paste(cell, (x, 0))
cx0, cy0, cx1, cy1 = 2, 4, W, H
out = out.crop((cx0, cy0, cx1, cy1))
w, h = out.size
out.save(root / 'public' / 'danmaku' / 'bubbles' / 'huihui.png', optimize=True)
TL, TR, TT, TB = 274, 462, 58, 216       # 文字区：左边让开人物，右边让开星星，上下在花边里面
print(f'size {w}x{h}')
print(f'cap: left {(L - cx0) / w * 100:.2f} right {(cx1 - R) / w * 100:.2f}')
print(f'box: left {(TL - cx0) / w * 100:.2f} right {(cx1 - TR) / w * 100:.2f} top {(TT - cy0) / h * 100:.2f} bottom {(cy1 - TB) / h * 100:.2f}')
