# 用参考图生成弹幕姬「萌萌专属气泡」九宫格素材：public/danmaku/bubbles/mengmeng.png
# 参考图是白底上的爱心便签纸，左边黑发少年、右边猫耳少女挨得很近。做法：
#   1. 白底抠掉（爱心纸面整块不透明，伸出爱心的星星按颜色抠出边缘）；
#   2. 沿两人之间的空隙找一条弯曲的切线，把左半（少年 + 黄星星）和右半（少女 + 蓝星星）分开，
#      中间补一段「横格纸」——每一行颜色取自原图这一行的纸面，横线自然对齐；
#   3. 这段横格纸是左右一样的，border-image 平铺它，弹幕越长两人分得越开，人物和爱心两端不变形。
# 改了图要换文件名（PNG 缓存一天），并在 lib/danmaku.cjs 的 RETIRED_IMAGES 里登记旧名字。
# 需要 Pillow + numpy：python scripts/build-mengmeng-bubble.py
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent.parent
src = Image.open(root / 'docs' / 'danmaku-bubbles' / 'mengmeng-reference.webp').convert('RGB')
W, H = src.size  # 1564×1172
rgb = np.asarray(src).astype(np.float32)
low = rgb.min(2)

# ---- 1. 抠白底 ----
# 爱心纸面：非纯白的点模糊一下连成一片，阈值得到爱心形状，再柔化边缘。
paper = Image.fromarray(((low < 253) * 255).astype(np.uint8))
heart = paper.filter(ImageFilter.GaussianBlur(30)).point(lambda v: 255 if v > 70 else 0)
# 纸面里有纯白的小块，会在爱心里抠出洞：从外面灌水，灌不到的都算爱心。
outside = Image.new('L', (W + 2, H + 2), 0); outside.paste(heart, (1, 1))
from PIL import ImageDraw
ImageDraw.floodfill(outside, (0, 0), 128)
heart = outside.crop((1, 1, W + 1, H + 1)).point(lambda v: 0 if v == 128 else 255)
# 边缘磨圆：先闭后开，去掉毛刺和小缺口，最后柔化 3px。
heart = heart.filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.MinFilter(31))
heart = heart.filter(ImageFilter.MinFilter(31)).filter(ImageFilter.MaxFilter(31))
heart = heart.filter(ImageFilter.GaussianBlur(3))
heart = np.asarray(heart).astype(np.float32) / 255
# 爱心外面的星星：按「离白色多远」算透明度，颜色反算回去，边缘不发白。
ink = np.clip((255 - low) / 60, 0, 1)
alpha = np.maximum(heart, ink)
safe = np.maximum(alpha, 1e-3)[..., None]
color = np.where(alpha[..., None] > 0, (rgb - 255 * (1 - alpha[..., None])) / safe, 255)
color = np.where(heart[..., None] >= 0.999, rgb, np.clip(color, 0, 255))
rgba = np.dstack([color, alpha * 255]).clip(0, 255)

# ---- 2. 两人之间的切线 ----
# 人物线稿和上色：明显比纸面深或有颜色的点。横线是淡紫色细线（最深 ≈185、饱和度 ≈14），不算。
sat = rgb.max(2) - low
body = (low < 160) | (sat > 40)
body_img = Image.fromarray((body * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
body = np.asarray(body_img) > 0
# 从少年、少女身上各取一点，按连通区域分左右。
from collections import deque
def grow(seeds):
    seen = np.zeros_like(body)
    q = deque()
    for x, y in seeds:
        assert body[y, x], (x, y)
        seen[y, x] = True; q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H and body[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((nx, ny))
    return seen
boy = grow([(500, 470)])
girl = grow([(1100, 470), (880, 300)])
assert not (boy & girl).any(), '左右两半连在一起了'

CUT = 760          # 没有人物的行（爱心顶上和底下）切在这里，正好是爱心中缝和尖
PAD = 6           # 每行看上下各 6 行，切线放在两人之间空隙的正中（最窄处两人头发只隔 ≈8px）
cut = np.full(H, CUT, dtype=np.float64)
for y in range(H):
    lo, hi = max(0, y - PAD), min(H, y + PAD + 1)
    lx = np.where(boy[lo:hi, 600:1000].any(0))[0]
    rx = np.where(girl[lo:hi, 600:1000].any(0))[0]
    if not len(lx) and not len(rx): continue
    left_edge = 600 + lx.max() if len(lx) else None
    right_edge = 600 + rx.min() if len(rx) else None
    if left_edge is None: left_edge = min(CUT, right_edge - 20)
    if right_edge is None: right_edge = max(CUT, left_edge + 20)
    assert left_edge < right_edge, f'第 {y} 行两人之间没空隙'
    cut[y] = (left_edge + right_edge) / 2
cut = np.round(cut).astype(int)
Lmax, Rmin = cut.max(), cut.min()

# ---- 3. 中间补的横格纸 ----
# 每一行取原图这一行纸面的颜色（爱心中缝附近、不压人物的点的中位数），横线和爱心上下边缘都自然接上。
fill = np.zeros((H, 4), dtype=np.float32)
clean = ~(boy | girl)
for y in range(H):
    xs = [x for x in range(cut[y] - 6, cut[y] + 7) if clean[y, x]]
    if len(xs) < 4:
        xs = [x for x in range(560, 1000) if clean[y, x]]
    fill[y] = np.median(rgba[y, xs], axis=0)

T = 120            # 平铺段宽度（原图像素）
shift = (Lmax - Rmin) + T
OW = W + shift
out = np.zeros((H, OW, 4), dtype=np.float32)
for y in range(H):
    c = cut[y]
    out[y, :c] = rgba[y, :c]
    out[y, c:c + shift] = fill[y]
    out[y, c + shift:] = rgba[y, c:]
# 切口两边纸面纹理和补的纯色纸差一点：切口左右 6px 渐变过去。
B = 6
for y in range(H):
    c = cut[y]
    for k in range(B):
        t = (k + 0.5) / B
        out[y, c - B + k] = out[y, c - B + k] * (1 - t) + fill[y] * t
        out[y, c + shift + B - 1 - k] = out[y, c + shift + B - 1 - k] * (1 - t) + fill[y] * t

img = Image.fromarray(out.round().astype(np.uint8), 'RGBA')
x0, y0, x1, y1 = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
x0, y0, x1, y1 = max(0, x0 - 4), max(0, y0 - 4), min(OW, x1 + 4), min(H, y1 + 4)
# 切线都取偶数，缩小一半后还在整像素上
x0 -= (Lmax - x0) % 2
x1 += (x1 - (Lmax + T)) % 2
y1 += (y1 - y0) % 2
img = img.crop((x0, y0, x1, y1))
w, h = img.size
img.resize((w // 2, h // 2), Image.LANCZOS).save(root / 'public' / 'danmaku' / 'bubbles' / 'mengmeng.png', optimize=True)

# 文字区：只在补出来的横格纸里，竖直方向在两人脸到手的高度（y≈400..820），文字区占一半不到，人物显得大一些。
TT, TB = 400, 820
capL, capR = Lmax - x0, x1 - (Lmax + T)
print(f'size {w // 2}x{h // 2} ratio {w}/{h}  cut {Rmin}..{Lmax}')
print(f'cap: left {capL / w * 100:.2f} right {capR / w * 100:.2f}')
print(f'box: left {capL / w * 100:.2f} right {capR / w * 100:.2f} top {(TT - y0) / h * 100:.2f} bottom {(y1 - TB) / h * 100:.2f}')
