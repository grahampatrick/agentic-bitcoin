"""Generates apps/web/public/anvard-vale.svg, the painted vale on the home page. Original art, deterministic.

Run: python3 scripts/vale.py apps/web/public/anvard-vale.svg
"""
import math, random, sys

W, H = 1400, 350
o = []
def P(pts, fill, op=1.0, extra=""):
    d = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    a = f' opacity="{op}"' if op != 1 else ""
    return f'<polygon points="{d}" fill="{fill}"{a} {extra}/>'
def C(x, y, r, fill, op=1.0):
    a = f' opacity="{op}"' if op != 1 else ""
    return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{fill}"{a}/>'
def RECT(x, y, w, h, fill, op=1.0, extra=""):
    a = f' opacity="{op}"' if op != 1 else ""
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" fill="{fill}"{a} {extra}/>'

clips = []
def cloud(cid, cx, base, w, h, seed, light="#f7f3ea", mid="#dfe6ee", shade="#8fa9c9"):
    r = random.Random(seed)
    n = max(5, int(w / 13))
    blobs = []
    for i in range(n):
        t = i / (n - 1)
        env = math.sin(math.pi * t) ** 0.75
        rad = (r.uniform(0.22, 0.42) * h) * (0.35 + 0.65 * env) + 5
        x = cx - w / 2 + t * w + r.uniform(-5, 5)
        y = base - rad * r.uniform(0.35, 0.8) - env * h * r.uniform(0.0, 0.5)
        blobs.append((x, y, rad))
    clips.append(f'<clipPath id="{cid}"><rect x="0" y="-200" width="{W}" height="{base + 200:.1f}"/></clipPath>')
    g = [f'<g clip-path="url(#{cid})">']
    g += [C(x + 4, y + 6, rad, shade) for x, y, rad in blobs]
    g += [C(x - 1, y, rad * 0.94, mid) for x, y, rad in blobs]
    g += [C(x - 5, y - 6, rad * 0.74, light) for x, y, rad in blobs]
    g.append("</g>")
    return "\n".join(g)

# ---------- sky ----------
sky = [RECT(-30, -150, W + 60, H + 190, "url(#sky)")]
r = random.Random(3)
# cirrus: long wisps sweeping up to the right, a few broad veils
def wisp(x, y, L, t, rise, op):
    return (f'<path d="M {x:.1f} {y:.1f} Q {x + L * 0.45:.1f} {y + rise * 0.3 - t:.1f} {x + L:.1f} {y + rise:.1f} '
            f'Q {x + L * 0.5:.1f} {y + rise * 0.45 + t * 0.5:.1f} {x:.1f} {y:.1f} Z" fill="#f0f4f6" opacity="{op:.2f}"/>')
for i in range(16):
    x = r.uniform(-120, 620); y = r.uniform(20, 170); L = r.uniform(220, 620)
    sky.append(wisp(x, y, L, r.uniform(2, 9), -L * r.uniform(0.05, 0.16), r.uniform(0.16, 0.42)))
for i in range(9):
    x = r.uniform(900, 1300); y = r.uniform(40, 150); L = r.uniform(160, 420)
    sky.append(wisp(x, y, L, r.uniform(2, 7), -L * r.uniform(0.03, 0.12), r.uniform(0.14, 0.36)))
for i in range(12):
    x = r.uniform(-120, 1250); y = r.uniform(-100, 10); L = r.uniform(200, 560)
    sky.append(wisp(x, y, L, r.uniform(2, 8), -L * r.uniform(0.04, 0.12), r.uniform(0.12, 0.3)))
for i in range(4):
    x = r.uniform(-100, 400); y = r.uniform(60, 190); L = r.uniform(400, 700)
    sky.append(wisp(x, y, L, r.uniform(14, 26), -L * r.uniform(0.04, 0.1), r.uniform(0.08, 0.16)))
o.append('<g filter="url(#brush)">' + "\n".join(sky) + "</g>")

# ---------- clouds ----------
cl = [
    cloud("c1", 1045, 34, 120, 60, 11),
    cloud("c2", 1290, 190, 260, 120, 12),
    cloud("c3", 1215, 205, 120, 60, 13, mid="#cfdbe8"),
    cloud("c4", 620, 232, 210, 150, 14),
    cloud("c5", 470, 228, 110, 95, 15),
    cloud("c6", 80, 40, 150, 50, 16),
    cloud("c7", 640, 70, 90, 26, 17),
    cloud("c8", 330, -40, 170, 46, 18),
    cloud("c9", 1240, -52, 110, 34, 19),
]
o.append('<g filter="url(#brushCloud)">' + "\n".join(cl) + "</g>")

# ---------- far mountains ----------
far = [
    P([(1150, 300), (1178, 205), (1228, 162), (1262, 146), (1300, 172), (1350, 196), (1430, 222), (1430, 300)], "#7e9cc2"),
    P([(1178, 205), (1228, 162), (1262, 146), (1250, 200), (1215, 262), (1170, 300), (1150, 300)], "#a3bcd8"),
    P([(1262, 146), (1300, 172), (1325, 230), (1290, 300), (1250, 300), (1262, 215)], "#6785ad"),
    # left mid-distance peak
    P([(190, 312), (212, 232), (242, 190), (268, 156), (296, 168), (342, 198), (418, 236), (500, 264), (548, 296), (548, 312)], "#6d90bd"),
    P([(190, 312), (212, 232), (242, 190), (268, 156), (262, 205), (240, 262), (225, 312)], "#93b2d6"),
    P([(268, 156), (296, 168), (342, 198), (380, 262), (330, 248), (292, 205)], "#5a7dab"),
    P([(300, 232), (360, 250), (440, 262), (520, 286), (548, 300), (430, 296), (330, 268)], "#d0802c", 0.9),
    P([(250, 262), (300, 268), (360, 290), (300, 296), (236, 290)], "#e09a3e", 0.85),
]
o.append('<g filter="url(#brushLichenFar)">' + "\n".join(far) + "</g>")

# ---------- central massif ----------
m = [
    P([(452, 308), (520, 262), (585, 214), (642, 168), (700, 104), (742, 40), (772, -10), (800, -58), (826, -100), (852, -72), (880, -36), (908, -8), (942, 30), (1012, 96),
       (1078, 142), (1152, 186), (1216, 226), (1292, 264), (1336, 308)], "#6c85a6"),
    # lit left faces
    P([(452, 308), (520, 262), (585, 214), (642, 168), (700, 104), (742, 40), (772, -10), (800, -58), (826, -100), (820, -30), (792, 70), (752, 150),
       (700, 214), (640, 268), (596, 308)], "#9fb2c8"),
    P([(585, 214), (642, 168), (700, 104), (690, 160), (650, 214), (600, 262), (560, 268)], "#bac7d6"),
    P([(742, 40), (772, -10), (800, -58), (798, -10), (770, 60), (740, 110), (722, 100)], "#c5d0dc"),
    # shadowed right faces
    P([(826, -100), (852, -72), (880, -36), (908, -8), (942, 30), (1012, 96), (1078, 142), (1040, 160), (980, 120), (930, 70), (890, 40), (858, -20)], "#506a8e"),
    P([(930, 70), (980, 120), (1040, 160), (1078, 142), (1152, 186), (1216, 226), (1160, 240), (1080, 205), (1000, 170)], "#435b80"),
    P([(826, -100), (858, -20), (890, 40), (930, 110), (900, 170), (860, 110), (830, 60), (820, -30)], "#7f96b4"),
    P([(752, 150), (792, 70), (830, 60), (860, 110), (880, 190), (850, 262), (800, 308), (700, 308), (700, 214)], "#8399b4"),
    P([(880, 190), (900, 170), (1000, 170), (1080, 205), (1160, 240), (1216, 226), (1292, 264), (1336, 308), (850, 308), (850, 262)], "#5b7495"),
    # orange flanks, following the slope
    P([(856, -52), (900, 2), (955, 62), (1025, 118), (1002, 124), (940, 78), (892, 28)], "#d98630"),
    P([(985, 128), (1052, 160), (1128, 196), (1200, 232), (1150, 232), (1070, 196), (1010, 162)], "#cf7624"),
    P([(1100, 232), (1180, 250), (1262, 268), (1310, 300), (1200, 296), (1120, 268)], "#e09a3e", 0.9),
    P([(905, 120), (935, 150), (960, 205), (940, 215), (915, 165)], "#c8742a", 0.85),
    P([(668, 150), (700, 118), (712, 150), (680, 196), (650, 214)], "#d98630", 0.75),
    P([(540, 262), (590, 236), (620, 250), (575, 286), (520, 296)], "#e09a3e", 0.8),
    P([(770, 200), (800, 170), (820, 205), (790, 250), (760, 262)], "#cf7624", 0.6),
]
o.append('<g filter="url(#brushLichen)">' + "\n".join(m) + "</g>")

o.append('<rect x="-30" y="236" width="1460" height="84" fill="url(#haze)"/>')

# ---------- near left ridge ----------
lr = [
    P([(-30, 78), (0, 92), (58, 118), (118, 150), (186, 204), (246, 250), (298, 286), (348, 322), (348, 380), (-30, 380)], "#8793a2"),
    P([(0, 92), (58, 118), (118, 150), (100, 205), (60, 262), (-30, 310), (-30, 78)], "#b8c0c8"),
    P([(118, 150), (186, 204), (246, 250), (200, 268), (140, 232), (100, 205)], "#a2adb9"),
    P([(60, 262), (100, 205), (140, 232), (200, 268), (160, 310), (90, 330), (0, 340), (0, 300)], "#6f7d8f"),
    P([(246, 250), (298, 286), (348, 322), (348, 350), (200, 350), (160, 310), (200, 268)], "#5c6a7e"),
    P([(70, 150), (128, 178), (196, 232), (262, 278), (238, 286), (170, 242), (104, 196)], "#d98630"),
    P([(20, 200), (70, 232), (120, 286), (90, 296), (40, 250), (0, 232), (0, 205)], "#cf7624", 0.9),
    P([(180, 290), (250, 300), (330, 330), (348, 350), (230, 350)], "#e09a3e", 0.9),
]
o.append('<g filter="url(#brushLichen)">' + "\n".join(lr) + "</g>")

# ---------- meadow ----------
r = random.Random(8)
top = [(300, 380)]
x = 300
while x <= 1200:
    top.append((x, 302 + 5 * math.sin(x / 70.0) + r.uniform(-2, 2) + (10 if x < 420 else 0)))
    x += 30
top += [(1200, 380)]
md = [P(top, "url(#meadow)")]
for i in range(240):
    x = r.uniform(310, 1190); y = r.uniform(306, 350); L = r.uniform(14, 70); t = r.uniform(1, 3.2)
    col = r.choice(["#f0b44a", "#e9a53a", "#b9650f", "#a3540c", "#f6c768", "#c97618"])
    md.append(P([(x, y), (x + L, y - r.uniform(0, 3)), (x + L * 0.6, y + t)], col, r.uniform(0.35, 0.85)))
# a pale road curling to the gate
md.append('<path d="M 808 312 C 800 322, 760 326, 700 332 S 560 344, 470 350 L 560 350 C 640 344, 760 336, 822 322 Z" fill="#f1dfb6" opacity="0.8"/>')
o.append('<g filter="url(#brush)">' + "\n".join(md) + "</g>")

# ---------- right dark slope ----------
rs = [
    P([(1118, 350), (1150, 302), (1200, 264), (1262, 236), (1330, 202), (1430, 154), (1430, 380), (1100, 380)], "#c86f17"),
    P([(1150, 302), (1200, 264), (1262, 236), (1330, 202), (1430, 154), (1430, 206), (1340, 232), (1280, 262), (1220, 290), (1170, 320), (1140, 330)], "#263657"),
    P([(1200, 264), (1262, 236), (1300, 232), (1250, 262), (1210, 286)], "#34476c"),
    P([(1280, 262), (1340, 232), (1430, 206), (1430, 258), (1350, 268), (1300, 290)], "#e69a2e"),
    P([(1170, 320), (1220, 290), (1300, 290), (1350, 268), (1430, 258), (1430, 380), (1100, 380)], "#d17c1c"),
    P([(1230, 320), (1300, 306), (1400, 300), (1400, 318), (1310, 322), (1250, 336)], "#a3540c", 0.8),
    P([(1160, 340), (1240, 336), (1330, 340), (1430, 334), (1430, 380), (1130, 380)], "#8a4409", 0.8),
]
for i in range(60):
    x = r.uniform(1180, 1400); y = r.uniform(270, 350); L = r.uniform(12, 50)
    rs.append(P([(x, y), (x + L, y - L * 0.25), (x + L * 0.6, y + 2)], r.choice(["#f6c768", "#f0b44a", "#b9650f"]), r.uniform(0.3, 0.7)))
o.append('<g filter="url(#brush)">' + "\n".join(rs) + "</g>")

# ---------- the castle ----------
LIT, MIDC, SHD, DEEP = "#f5f1e7", "#e4e1d8", "#a7b4c7", "#7c8ca6"
RED, REDS, GOLD, DARK = "#bf3229", "#74141a", "#e4b04a", "#283042"
c = []
def crenel(x0, x1, y, fill, mw=6, gap=5, mh=5):
    out = []; x = x0
    while x + mw <= x1 + 0.1:
        out.append(RECT(x, y - mh, mw, mh, fill)); x += mw + gap
    return out
def tower(x, w, top, base, roof=0, crown=4, flag=None, slits=(), batter=0.06):
    """A round tower lit from the left, a little wider at the foot; corbelled crown; optional cone roof."""
    b = (base - top) * batter
    out = [P([(x, top), (x + w, top), (x + w + b, base), (x - b, base)], "url(#stone)")]
    out += [RECT(x - crown, top - 9, w + 2 * crown, 10, "url(#stone)"), RECT(x - crown, top + 1, w + 2 * crown, 2.4, DEEP, 0.55)]
    mw = max(4, w / 7); gap = max(3, w / 9)
    out += crenel(x - crown, x + w * 0.55, top - 9, LIT, mw=mw, gap=gap, mh=5)
    out += crenel(x + w * 0.62, x + w + crown, top - 9, SHD, mw=mw, gap=gap, mh=5)
    if roof:
        cx = x + w / 2; ry = top - 9
        out += [P([(x - 2, ry), (cx, ry - roof), (x + w + 2, ry)], "url(#tile)")]
        if flag:
            out += [RECT(cx - 0.6, ry - roof - 15, 1.2, 16, DARK), P([(cx + 0.6, ry - roof - 15), (cx + 16, ry - roof - 11), (cx + 0.6, ry - roof - 7)], flag)]
    for sy in slits:
        out.append(RECT(x + w * 0.3, sy, 2.2, 8, DARK, 0.8))
    return out
G = 314  # ground line at the castle
# cast shadow on the meadow, to the right
c.append(P([(668, G), (1070, G - 2), (1190, G + 16), (1020, G + 22), (700, G + 7)], "#6e380c", 0.5))
# hall behind the wall
c += [RECT(752, 226, 132, 50, "url(#stone)"), P([(744, 228), (818, 190), (892, 228)], "url(#tile)")]
# the tall towers
c += tower(712, 40, 84, G, roof=52, flag=GOLD, slits=(118, 160, 204, 244))
c += tower(868, 28, 138, G, roof=38, flag=RED, slits=(166, 208))
c += tower(808, 20, 176, G, roof=28, slits=(196,))
c += tower(770, 14, 204, G, roof=20)
# the curtain wall, with a return wall in shadow running back to the right
c += [RECT(652, 266, 318, G - 266, "url(#wall)")]
c += crenel(652, 970, 266, LIT, mw=7, gap=6, mh=6)
c += [P([(970, 266), (1046, 277), (1046, G - 1), (970, G)], "url(#wallShade)")]
c += [P([(970 + i * 12.5, 266 + i * 1.8), (977 + i * 12.5, 267 + i * 1.8), (977 + i * 12.5, 261 + i * 1.8), (970 + i * 12.5, 260 + i * 1.8)], SHD) for i in range(6)]
# corner towers
c += tower(632, 38, 238, G, roof=32, slits=(258, 284))
c += tower(950, 38, 232, G, roof=32, flag=GOLD, slits=(252, 282))
c += tower(1034, 22, 250, G - 1, roof=20)
# gatehouse
c += [RECT(776, 248, 68, G - 248, "url(#wall)"), RECT(824, 248, 20, G - 248, SHD, 0.9)]
c += crenel(776, 844, 248, LIT, mw=7, gap=5, mh=6)
c += [f'<path d="M 796 {G} L 796 292 A 14 14 0 0 1 824 292 L 824 {G} Z" fill="{DARK}"/>',
      f'<path d="M 800 {G} L 800 294 A 10 10 0 0 1 820 294 L 820 {G} Z" fill="#0f1420"/>',
      RECT(785, 262, 3, 9, DARK, 0.8), RECT(832, 262, 3, 9, DARK, 0.55), P([(803, 248), (810, 236), (817, 248)], GOLD)]
for sx in (678, 708, 738, 760, 866, 896, 926):
    c.append(RECT(sx, 282, 2.2, 9, DARK, 0.6))
c += [RECT(742, 272, 12, 22, RED), P([(742, 294), (748, 289), (754, 294)], LIT)]
o.append('<g filter="url(#brushFine)">' + "\n".join(c) + "</g>")

# ---------- small things: cottages on the left, a watchtower dome ----------
s = []
for (x, y, w) in ((452, 334, 22), (484, 338, 18), (420, 340, 16), (520, 332, 14)):
    s += [RECT(x, y - 9, w, 9, LIT), RECT(x + w * 0.6, y - 9, w * 0.4, 9, SHD), P([(x - 2, y - 9), (x + w / 2, y - 18), (x + w + 2, y - 9)], RED)]
s += [f'<path d="M 560 318 A 14 14 0 0 1 588 318 Z" fill="{LIT}"/>', f'<path d="M 576 318 A 14 14 0 0 0 574 304 A 14 14 0 0 1 588 318 Z" fill="{SHD}"/>']
o.append('<g filter="url(#brushFine)">' + "\n".join(s) + "</g>")

defs = f'''<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#1a4284"/><stop offset="0.36" stop-color="#3468aa"/>
  <stop offset="0.6" stop-color="#7ba5d1"/><stop offset="0.78" stop-color="#b9d2e7"/><stop offset="1" stop-color="#dde9f1"/>
</linearGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#dfe9f1" stop-opacity="0"/><stop offset="1" stop-color="#e8eef2" stop-opacity="0.42"/>
</linearGradient>
<linearGradient id="meadow" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#e59a2a"/><stop offset="1" stop-color="#c06d12"/>
</linearGradient>
<linearGradient id="stone" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#fbf8ef"/><stop offset="0.38" stop-color="#efebe0"/>
  <stop offset="0.6" stop-color="#b9c3d2"/><stop offset="1" stop-color="#8797b1"/>
</linearGradient>
<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#f7f3e9"/><stop offset="0.6" stop-color="#f1e9d8"/><stop offset="1" stop-color="#e6cfa4"/>
</linearGradient>
<linearGradient id="wallShade" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#9eadc3"/><stop offset="1" stop-color="#a99a8d"/>
</linearGradient>
<linearGradient id="tile" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#d9463a"/><stop offset="0.5" stop-color="#b82a22"/>
  <stop offset="0.56" stop-color="#84181b"/><stop offset="1" stop-color="#641014"/>
</linearGradient>
<filter id="brush" x="-2%" y="-5%" width="104%" height="110%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="4" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="brushFine" x="-2%" y="-5%" width="104%" height="110%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="9" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="brushCloud" x="-2%" y="-10%" width="104%" height="120%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="4" seed="2" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="11" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="brushLichen" x="-2%" y="-5%" width="104%" height="110%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="6" result="w"/>
  <feDisplacementMap in="SourceGraphic" in2="w" scale="9" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.02 0.055" numOctaves="4" seed="12" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.84  0 0 0 0 0.50  0 0 0 0 0.17  6 0 0 0 -3.5" result="o"/>
  <feComposite in="o" in2="d" operator="in" result="oc"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.16  0 0 0 0 0.22  0 0 0 0 0.36  0 -3 0 0 1.05" result="k"/>
  <feComposite in="k" in2="d" operator="in" result="kc"/>
  <feMerge><feMergeNode in="d"/><feMergeNode in="kc"/><feMergeNode in="oc"/></feMerge>
</filter>
<filter id="brushLichenFar" x="-2%" y="-5%" width="104%" height="110%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="16" result="w"/>
  <feDisplacementMap in="SourceGraphic" in2="w" scale="7" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.03 0.07" numOctaves="3" seed="22" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.86  0 0 0 0 0.56  0 0 0 0 0.24  5 0 0 0 -3.1" result="o"/>
  <feComposite in="o" in2="d" operator="in" result="oc"/>
  <feMerge><feMergeNode in="d"/><feMergeNode in="oc"/></feMerge>
</filter>
<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="5" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.06  0 0 0 0 0.09  0 0 0 0 0.18  0 0 0 1.5 -0.62"/>
</filter>
<filter id="grainLight" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="31" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 0.97  0 0 0 0 0.9  0 0 0 1.4 -0.66"/>
</filter>
{"".join(clips)}
</defs>'''

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -110 {W} {H + 110}" preserveAspectRatio="xMidYMax slice" role="img" aria-label="A painted vale: a pale castle with red roofs below a mountain, orange hills, a blue sky.">
{defs}
{chr(10).join(o)}
<rect y="-110" width="{W}" height="{H + 110}" filter="url(#grain)" opacity="0.26"/>
<rect y="-110" width="{W}" height="{H + 110}" filter="url(#grainLight)" opacity="0.2"/>
</svg>
'''
open(sys.argv[1], "w").write(svg)
print(len(svg))
