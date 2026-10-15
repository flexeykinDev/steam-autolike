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


# ======================= TEXT (EN / RU) =======================
L = {
  "en": {
    "chip": "FIREFOX EXTENSION",
    "sub": ["Likes and one emoticon comment for every friend's", "post in your Steam feed — never twice."],
    "tags": ["Auto-likes", "Emoticon pool", "Anti-spam aware"],
    "features": [
      ("01", "Likes friends", ["Likes feed posts that", "aren't liked yet."]),
      ("02", "Never twice", ["Reads every page of a thread", "before it comments."]),
      ("03", "Emoticon pool", ["Pick your Steam emoticons,", "random ones in each comment."]),
      ("04", "Friends filter", ["All, only the list or everyone", "except it — per post type too."]),
      ("05", "Respects Steam", ["Catches the anti-spam limit,", "daily caps, quiet hours."]),
      ("06", "Dry run", ["Checks everything, clicks", "nothing — see what it would do."]),
      ("07", "Auto-run", ["Every N hours in a background", "tab, only new posts."]),
      ("08", "Statistics", ["14-day pixel chart and", "your top friends."]),
      ("09", "Stays on the feed", ["Blocks stray navigations and", "survives page reloads."]),
    ],
    "steps_title": "Start",
    "steps": [
      ("1", "Get the .xpi", ["From Releases of", "this repository."]),
      ("2", "Install", ["Drag it into Firefox", "or use about:debugging."]),
      ("3", "Run", ["Open your Steam feed,", "click ♥ → Start."]),
    ],
    "headings": [("Features", "features"), ("Interface", "ui"), ("Install", "install"),
                 ("Settings", "settings"), ("How it works", "how"), ("Development", "dev"), ("Heads-up", "warning")],
  },
  "ru": {
    "chip": "FIREFOX EXTENSION",
    "sub": ["Лайки и комментарии друзьям в ленте Steam —", "без спама и с уважением к антиспаму Steam."],
    "tags": ["Автолайки", "Пул смайликов", "Кулдаун"],
    "features": [
      ("01", "Лайки друзьям", ["Ставит лайк на посты ленты,", "если его ещё нет."]),
      ("02", "Без повторов", ["Читает все страницы ветки", "перед комментарием."]),
      ("03", "Пул смайликов", ["Выбираешь смайлики Steam,", "в каждый коммент — случайные."]),
      ("04", "Фильтр друзей", ["Все, только список или все кроме —", "и отдельно по типам постов."]),
      ("05", "Бережно к Steam", ["Ловит антиспам-лимит,", "дневные лимиты, тихие часы."]),
      ("06", "Тестовый прогон", ["Всё проверяет, ничего не жмёт —", "видно, что бы сделал."]),
      ("07", "Автозапуск", ["Раз в N часов в фоновой", "вкладке, только новое."]),
      ("08", "Статистика", ["Пиксельный график за 14 дней", "и топ друзей."]),
      ("09", "Не уходит с ленты", ["Блокирует лишние переходы,", "переживает перезагрузку."]),
    ],
    "steps_title": "Старт",
    "steps": [
      ("1", "Скачай .xpi", ["Из раздела Releases", "этого репозитория."]),
      ("2", "Установи", ["Перетащи файл в Firefox", "или about:debugging."]),
      ("3", "Запусти", ["Открой ленту Steam,", "иконка ♥ → Старт."]),
    ],
    "headings": [("Что умеет", "features"), ("Интерфейс", "ui"), ("Установка", "install"),
                 ("Настройки", "settings"), ("Как устроено", "how"), ("Разработка", "dev"), ("Важно", "warning")],
  },
}


# ======================= BANNER =======================
def banner(lang):
    T = L[lang]
    W, H = 1200, 360
    rng = random.Random(7)
    b = [panel(0, 0, W, H, 6, fill="#0b0b0e")]

    # mosaic on the right with a heart showing through
    cell, gap = 14, 3
    step = cell + gap
    cols, rows = 26, 18
    gx0, gy0 = W - cols*step - 26, (H - rows*step) // 2 + 2
    hr0, hc0 = 1, 7   # 9×8 heart, each of its pixels = 2×2 cells
    for r in range(rows):
        for c in range(cols):
            fade = c / cols
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
    b.append('<defs><linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="#0b0b0e" stop-opacity="1"/>'
             '<stop offset=".35" stop-color="#0b0b0e" stop-opacity=".0"/></linearGradient></defs>')
    b.append(f'<rect x="{gx0-2}" y="2" width="{cols*step+4}" height="{H-4}" fill="url(#fade)"/>')

    b.append(panel(56, 62, 214, 30, 2, fill="#16131f", line=ACC_DEEP))
    b.append(text(70, 82, T["chip"], 12, ACC, 700, ls=2))
    b.append(text(54, 168, "Steam Autolike", 68, TEXT, 800, ls=-1.5))
    b.append(text(56, 210, T["sub"][0], 22, MUTED))
    b.append(text(56, 240, T["sub"][1], 22, MUTED))
    x = 56
    for label in T["tags"]:
        b.append(marker(x, 287))
        b.append(text(x + 16, 295, label, 16, TEXT, 600))
        x += 16 + len(label) * 9.6 + 28
    b.append(dust(W, H, 40, rng))
    b.append(grain(W, H))
    return svg(W, H, "".join(b))


# ======================= FEATURE CARDS (3×3) =======================
def features(lang):
    items = L[lang]["features"]
    W, cols, cw, ch, gap = 1200, 3, 384, 196, 24
    rows = (len(items) + cols - 1) // cols
    H = rows * ch + (rows - 1) * gap
    rng = random.Random(3)
    b = []
    for i, (num, title, desc) in enumerate(items):
        x = (i % cols) * (cw + gap)
        y = (i // cols) * (ch + gap)
        b.append(panel(x, y, cw, ch, 4, fill="#0e0e11"))
        ds, _ = dots(num, x + 28, y + 28, d=5, g=1, on=ACC if i % 4 == 0 else TEXT)
        b.append(ds)
        b.append(text(x + 28, y + 112, title, 22, TEXT, 700))
        for k, line in enumerate(desc):
            b.append(text(x + 28, y + 142 + k * 24, line, 16, MUTED))
        b.append(f'<rect x="{x + cw - 24}" y="{y + 20}" width="5" height="5" fill="{LINE_HI}"/>')
    b.append(dust(W, H, 24, rng))
    b.append(grain(W, H, .05))
    return svg(W, H, "".join(b))


# ======================= INSTALL STEPS =======================
def steps(lang):
    T = L[lang]
    W, cw, ch, gap = 1200, 376, 200, 12
    H = ch + 64
    rng = random.Random(11)
    b = [panel(0, 0, W, H, 6, fill="#0b0b0e")]
    b.append(marker(24, 24))
    b.append(text(42, 32, T["steps_title"], 18, TEXT, 700))
    for i, (num, title, desc) in enumerate(T["steps"]):
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


# ======================= SECTION HEADING =======================
def heading(label):
    W, H = 1200, 44
    b = [marker(2, 18), text(22, 27, label, 20, TEXT, 700)]
    x = 22 + len(label) * 11.5 + 24
    while x < W - 4:
        b.append(f'<rect x="{int(x)}" y="21" width="3" height="3" fill="{LINE}"/>')
        x += 9
    return svg(W, H, "".join(b))


def write(name, content):
    open(os.path.join(OUT, name), "w").write(content)


for lang in ("en", "ru"):
    write(f"banner-{lang}.svg", banner(lang))
    write(f"features-{lang}.svg", features(lang))
    write(f"steps-{lang}.svg", steps(lang))
    for label, name in L[lang]["headings"]:
        write(f"h-{name}-{lang}.svg", heading(label))

# old single-language files from 1.x
for old in ["banner.svg", "features.svg", "steps.svg"] + [f"h-{n}.svg" for n in ["features", "ui", "install", "settings", "how", "warning"]]:
    p = os.path.join(OUT, old)
    if os.path.exists(p):
        os.remove(p)
print("ok")
