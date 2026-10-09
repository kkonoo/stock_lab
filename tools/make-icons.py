# 앱 아이콘(icons/app-*.png) 그리기: 남색 타일 위에 오르는 캔들 3개(빨강 = 오름, 파랑 = 내림)
# maskable = 안드로이드·아이폰용, 배경을 꽉 채우고 그림은 가운데 안전 영역 안에
# 실행: pip install pillow && python tools/make-icons.py
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
TILE, RED, BLUE, LINE = "#1F2433", "#F05A5A", "#4C8DF6", "#F5F4F0"
S = 4  # 크게 그린 뒤 줄여서 가장자리를 부드럽게


def draw(size, maskable):
    big = size * S
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = big / 512  # 512 기준 좌표 → 실제 크기
    if maskable:
        d.rectangle([0, 0, big, big], fill=TILE)
        k, off = 0.78, 512 * 0.11  # 그림을 가운데로 줄임 (안전 영역)
    else:
        d.rounded_rectangle([40 * u, 40 * u, 472 * u, 472 * u], radius=104 * u, fill=TILE)
        k, off = 1.0, 0

    def p(x, y):
        return ((x * k + off) * u, (y * k + off) * u)

    # 캔들: (가운데 x, 꼬리 위, 몸통 위, 몸통 아래, 꼬리 아래, 색)
    for cx, wt, bt, bb, wb, color in [
        (166, 236, 262, 342, 366, BLUE),
        (256, 168, 196, 300, 322, RED),
        (346, 104, 128, 236, 258, RED),
    ]:
        d.rounded_rectangle([*p(cx - 6, wt), *p(cx + 6, wb)], radius=6 * u * k, fill=color)
        d.rounded_rectangle([*p(cx - 34, bt), *p(cx + 34, bb)], radius=12 * u * k, fill=color)
    # 바닥선
    d.rounded_rectangle([*p(116, 396), *p(396, 410)], radius=7 * u * k, fill=LINE)
    return im.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
for size in (192, 512):
    draw(size, False).save(OUT / f"app-{size}.png", optimize=True)
    draw(size, True).save(OUT / f"app-maskable-{size}.png", optimize=True)
print("icons/ 에 저장했어요")
