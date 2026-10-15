"""Генерирует SVG-картинки для README в пиксельном dot-matrix стиле расширения."""
import random, os
from xml.sax.saxutils import escape

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".github", "assets")
os.makedirs(OUT, exist_ok=True)

BG, PANEL, LINE, LINE_HI = "#09090b", "#0f0f12", "#2a2a31", "#3a3a44"
TEXT, MUTED, DIM = "#ececf1", "#85858f", "#55555e"
ACC, ACC_DEEP, ACC_HI, ACC_LO = "#b9a8ff", "#7a68d6", "#ece6ff", "#9a87f0"
OFF = "#1a1a20"
FONT = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "'JetBrains Mono', Consolas, 'Courier New', monospace"

GLYPH = {
  "0":["01110","10001","10011","10101","11001","10001","01110"],
  "1":["00100","01100","00100","00100","00100","00100","01110"],
  "2":["01110","10001","00001","00010","00100","01000","11111"],
  "3":["11111","00010","00100","00010","00001","10001","01110"],
  "4":["00010","00110","01010","10010","11111","00010","00010"],
  "5":["11111","10000","11110","00001","00001","10001","01110"],
  "6":["00110","01000","10000","11110","10001","10001","01110"],
  "7":["11111","00001","00010","00100","01000","01000","01000"],
  "8":["01110","10001","10001","01110","10001","10001","01110"],
  "9":["01110","10001","10001","01111","00001","00010","01100"],
  ".":["0","0","0","0","0","0","1"],
}
HEART = ["011000110","111101111","111111111","111111111","011111110","001111100","000111000","000010000"]


def notch(x0, y0, x1, y1, s):
    p = [(x0, y0+2*s),(x0+s, y0+2*s),(x0+s, y0+s),(x0+2*s, y0+s),(x0+2*s, y0),
         (x1-2*s, y0),(x1-2*s, y0+s),(x1-s, y0+s),(x1-s, y0+2*s),(x1, y0+2*s),
         (x1, y1-2*s),(x1-s, y1-2*s),(x1-s, y1-s),(x1-2*s, y1-s),(x1-2*s, y1),
         (x0+2*s, y1),(x0+2*s, y1-s),(x0+s, y1-s),(x0+s, y1-2*s),(x0, y1-2*s)]
    return " ".join(f"{x},{y}" for x, y in p)


def panel(x, y, w, h, s=4, fill=PANEL, line=LINE):
    return (f'<polygon points="{notch(x, y, x+w, y+h, s)}" fill="{line}"/>'
            f'<polygon points="{notch(x+1, y+1, x+w-1, y+h-1, s)}" fill="{fill}"/>')


def dots(text, x, y, d=4, g=1, on=TEXT, off=OFF):
    """Число из точек 5×7. Возвращает (svg, ширина)."""
    out, cx = [], x
    for ch in text:
        rows = GLYPH[ch]
        for r, row in enumerate(rows):
            for c, bit in enumerate(row):
                col = on if bit == "1" else off
                out.append(f'<rect x="{cx + c*(d+g)}" y="{y + r*(d+g)}" width="{d}" height="{d}" fill="{col}"/>')
        cx += len(rows[0]) * (d+g) + d
    return "".join(out), cx - x - d


def text(x, y, s, size, color=TEXT, weight=400, family=FONT, anchor="start", ls=0):
    return (f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
            f'fill="{color}" text-anchor="{anchor}" letter-spacing="{ls}">{escape(s)}</text>')


def marker(x, y, color=ACC):
    return f'<rect x="{x}" y="{y}" width="7" height="7" fill="{color}"/>'


def defs():
    return ('<defs><filter id="grain" x="0" y="0" width="100%" height="100%">'
            '<feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/>'
            '<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0"/></filter></defs>')


def grain(w, h, opacity=.07):
    return f'<rect width="{w}" height="{h}" filter="url(#grain)" opacity="{opacity}"/>'


def dust(w, h, n, rng, avoid=None):
    out = []
    for _ in range(n):
        x, y = rng.randrange(8, w-8), rng.randrange(8, h-8)
        out.append(f'<rect x="{x}" y="{y}" width="2" height="2" fill="{"#3b3550" if rng.random() < .3 else "#2c2c33"}"/>')
    return "".join(out)


def svg(w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'shape-rendering="crispEdges">{defs()}{body}</svg>')


# ======================= БАННЕР =======================
def banner():
    W, H = 1200, 360
    rng = random.Random(7)
    b = [panel(0, 0, W, H, 6, fill="#0b0b0e")]

    # мозаика справа: сетка пикселей, к которой проявляется сердце
    cell, gap = 14, 3
    step = cell + gap
    cols, rows = 26, 18
    gx0, gy0 = W - cols*step - 26, (H - rows*step) // 2 + 2
    hr0, hc0 = 1, 7   # сердце 9×8, каждый его пиксель = 2×2 клетки
    for r in range(rows):
        for c in range(cols):
            fade = c / cols  # слева пиксели тусклее
            hr, hc = (r - hr0) // 2, (c - hc0) // 2
            in_heart = r >= hr0 and c >= hc0 and 0 <= hr < 8 and 0 <= hc < 9 and HEART[hr][hc] == "1"
            if not in_heart and rng.random() < .05 + (1 - fade) * .35:
                continue
            if in_heart:
                col = ACC_HI if (hr, hc) in [(1, 1), (1, 2), (2, 1)] else (ACC_LO if hr >= 5 else ACC)
            else:
                v = int(16 + rng.random() * 22 * (.4 + fade))
                col = f"rgb({v},{v},{v+5})" if rng.random() > .05 else "#2e2846"
            b.append(f'<rect x="{gx0 + c*step}" y="{gy0 + r*step}" width="{cell}" height="{cell}" fill="{col}"/>')
    # плавный переход мозаики в фон
    b.append('<defs><linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="#0b0b0e" stop-opacity="1"/>'
             '<stop offset=".35" stop-color="#0b0b0e" stop-opacity=".0"/></linearGradient></defs>')
    b.append(f'<rect x="{gx0-2}" y="2" width="{cols*step+4}" height="{H-4}" fill="url(#fade)"/>')

    # чип
    b.append(panel(56, 62, 214, 30, 2, fill="#16131f", line=ACC_DEEP))
    b.append(text(70, 82, "FIREFOX EXTENSION", 12, ACC, 700, ls=2))
    # заголовок
    b.append(text(54, 168, "Steam Autolike", 68, TEXT, 800, ls=-1.5))
    b.append(text(56, 210, "Лайки и комментарии друзьям в ленте Steam —", 22, MUTED))
    b.append(text(56, 240, "без спама и с уважением к антиспаму Steam.", 22, MUTED))
    # строка-метки
    x = 56
    for label in ["Автолайки", "Пул смайликов", "Кулдаун"]:
        b.append(marker(x, 287))
        b.append(text(x + 16, 295, label, 16, TEXT, 600))
        x += 16 + len(label) * 9.6 + 28
    # версия точками

    b.append(dust(W, H, 40, rng))
    b.append(grain(W, H))
    return svg(W, H, "".join(b))


# ======================= КАРТОЧКИ ВОЗМОЖНОСТЕЙ =======================
FEATURES = [
    ("01", "Лайки друзьям", ["Ставит лайк на посты ленты,", "если его ещё нет."]),
    ("02", "Без спама", ["Проверяет все комменты поста —", "второй раз свой не пишет."]),
    ("03", "Пул смайликов", ["Выбираешь смайлики Steam,", "в каждый коммент — случайные."]),
    ("04", "Антиспам Steam", ["Ловит лимит по ответу сервера", "и встаёт на кулдаун."]),
    ("05", "Не уходит с ленты", ["Блокирует переходы, а если ушло —", "само возвращается назад."]),
    ("06", "Помнит прогресс", ["Посты, лог и статистика", "переживают перезагрузку."]),
]


def features():
    W, cols, cw, ch, gap = 1200, 3, 384, 196, 24
    rows = 2
    H = rows * ch + (rows - 1) * gap
    rng = random.Random(3)
    b = []
    for i, (num, title, desc) in enumerate(FEATURES):
        x = (i % cols) * (cw + gap)
        y = (i // cols) * (ch + gap)
        b.append(panel(x, y, cw, ch, 4, fill="#0e0e11"))
        ds, _ = dots(num, x + 28, y + 28, d=5, g=1, on=ACC if i % 3 == 0 else TEXT)
        b.append(ds)
        b.append(text(x + 28, y + 112, title, 22, TEXT, 700))
        for k, line in enumerate(desc):
            b.append(text(x + 28, y + 142 + k * 24, line, 16, MUTED))
        b.append(f'<rect x="{x + cw - 24}" y="{y + 20}" width="5" height="5" fill="{LINE_HI}"/>')
    b.append(dust(W, H, 18, rng))
    b.append(grain(W, H, .05))
    return svg(W, H, "".join(b))


# ======================= ШАГИ УСТАНОВКИ =======================
STEPS = [
    ("1", "Скачай .xpi", ["Из раздела Releases", "этого репозитория."]),
    ("2", "Установи", ["Перетащи файл в Firefox", "или about:debugging."]),
    ("3", "Запусти", ["Открой ленту Steam,", "иконка ♥ → Старт."]),
]


def steps():
    W, cols, cw, ch, gap = 1200, 3, 376, 200, 12
    H = ch + 64
    rng = random.Random(11)
    b = [panel(0, 0, W, H, 6, fill="#0b0b0e")]
    b.append(marker(24, 24))
    b.append(text(42, 32, "Старт", 18, TEXT, 700))
    for i, (num, title, desc) in enumerate(STEPS):
        x = 24 + i * (cw + gap)
        y = 52
        b.append(panel(x, y, cw, ch - 8, 3, fill=PANEL))
        ds, _ = dots(num, x + 24, y + 24, d=4, g=1, on=ACC if i == 0 else TEXT)
        b.append(ds)
        b.append(text(x + 24, y + 96, title, 20, TEXT, 700))
        for k, line in enumerate(desc):
            b.append(text(x + 24, y + 124 + k * 22, line, 15, MUTED))
    b.append(dust(W, H, 16, rng))
    b.append(grain(W, H, .06))
    return svg(W, H, "".join(b))


# ======================= РАЗДЕЛИТЕЛЬ-ЗАГОЛОВОК =======================
def heading(label, name):
    W, H = 1200, 44
    b = [marker(2, 18), text(22, 27, label, 20, TEXT, 700)]
    # пунктир из пикселей до края
    x = 22 + len(label) * 11.5 + 24
    while x < W - 4:
        b.append(f'<rect x="{int(x)}" y="21" width="3" height="3" fill="{LINE}"/>')
        x += 9
    open(os.path.join(OUT, f"h-{name}.svg"), "w").write(svg(W, H, "".join(b)))


open(os.path.join(OUT, "banner.svg"), "w").write(banner())
open(os.path.join(OUT, "features.svg"), "w").write(features())
open(os.path.join(OUT, "steps.svg"), "w").write(steps())
for label, name in [("Что умеет", "features"), ("Интерфейс", "ui"), ("Установка", "install"),
                    ("Настройки", "settings"), ("Как устроено", "how"), ("Важно", "warning")]:
    heading(label, name)
print("ok")
