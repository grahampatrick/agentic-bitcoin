"""Generates apps/web/public/anvard-vale.svg, the painted valley on the home page.

A vector painting built from brush strokes: every rock face, the sky, the clouds and the grass are a
base shape plus hundreds of thin clipped strokes, then a displacement "brush" and paper grain.
Deterministic (seeded). Run: python3 scripts/vale.py apps/web/public/anvard-vale.svg
"""
import math, random, sys

W, H, TOP = 1400, 349, -110  # the frame, plus extra sky above for the page to fade into
defs, body = [], []
_n = [0]

def pts(p):
    return " ".join(f"{x:.0f},{y:.0f}" for x, y in p)
def poly(p, fill, op=1.0):
    a = f' opacity="{op:.2f}"' if op < 1 else ""
    return f'<polygon points="{pts(p)}" fill="{fill}"{a}/>'
def circ(x, y, r, fill, op=1.0):
    a = f' opacity="{op:.2f}"' if op < 1 else ""
    return f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r:.0f}" fill="{fill}"{a}/>'
def inside(p, x, y):
    c = False
    for i in range(len(p)):
        (x1, y1), (x2, y2) = p[i], p[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c
def stroke(x, y, L, t, a, fill, op):
    """One brush stroke: a thin lens centred on (x, y), length L, width t, angle a in degrees (y down)."""
    ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
    hx, hy = ca * L / 2, sa * L / 2
    nx, ny = -sa * t / 2, ca * t / 2
    return poly([(x - hx, y - hy), (x + nx, y + ny), (x + hx, y + hy), (x - nx, y - ny)], fill, op)
def strokes(face, n, angle, jitter, L, t, palette, seed, op=(0.3, 0.75), accept=None):
    r = random.Random(seed)
    xs = [p[0] for p in face]; ys = [p[1] for p in face]
    out, tries = [], 0
    while len(out) < n and tries < n * 60:
        tries += 1
        x, y = r.uniform(min(xs), max(xs)), r.uniform(min(ys), max(ys))
        if not inside(face, x, y):
            continue
        if accept and r.random() > accept(x, y):
            continue
        out.append(stroke(x, y, r.uniform(*L), r.uniform(*t), angle + r.uniform(-jitter, jitter), r.choice(palette), r.uniform(*op)))
    return out
def face(p, base, layers, flt="brush"):
    """A clipped face: base fill, then stroke layers, all bent by the brush filter."""
    _n[0] += 1
    cid = f"f{_n[0]}"
    defs.append(f'<clipPath id="{cid}"><polygon points="{pts(p)}"/></clipPath>')
    inner = [poly(p, base)]
    for l in layers:
        inner += l
    return f'<g filter="url(#{flt})"><g clip-path="url(#{cid})">' + "".join(inner) + "</g></g>"
def lerp_line(line, x):
    for (x1, y1), (x2, y2) in zip(line, line[1:]):
        if x1 <= x <= x2:
            return y1 + (y2 - y1) * (x - x1) / (x2 - x1)
    return 1e9

# ------------------------------------------------------------------ sky
SKY = [(-40, TOP - 40), (W + 40, TOP - 40), (W + 40, H + 40), (-40, H + 40)]
body.append(face(SKY, "url(#sky)", [
    strokes(SKY, 330, 0, 4, (70, 300), (2, 8), ["#5a84b2", "#6a90b8", "#4470a3", "#7f9fc0", "#3f6a9f", "#547fae"], 1, (0.18, 0.5)),
    # paler bands and wisps high on the left
    strokes([(-40, -20), (620, -20), (620, 80), (-40, 120)], 46, -3, 5, (120, 420), (3, 12), ["#93abc6", "#a9bccd", "#c9d3d8", "#8aa1bc"], 2, (0.25, 0.6)),
    strokes([(20, 0), (300, 0), (330, 70), (60, 60)], 16, 12, 6, (90, 260), (3, 9), ["#ece8da", "#dfe2da", "#f3eedd"], 3, (0.45, 0.85)),
    strokes(SKY, 40, -4, 5, (160, 520), (2, 6), ["#a9bccd", "#c2cdd4"], 4, (0.12, 0.3), accept=lambda x, y: 1.0 if y < -10 else 0.25),
], flt="brushSky"))
body.append(f'<rect x="-40" y="{TOP - 40}" width="{W + 80}" height="{H - TOP + 80}" fill="url(#hazeRight)"/>')
body.append('<ellipse cx="50" cy="40" rx="230" ry="110" fill="#9fb3c8" opacity="0.5" filter="url(#soft)"/>')

# ------------------------------------------------------------------ clouds
def cloud(shade, mid, cream, shade_col="#9db3cf", mid_col="#c3d0d8", cream_col="#f6eed9", seed=1):
    r = random.Random(seed)
    g = [circ(x, y, rad, shade_col) for x, y, rad in shade]
    g += [circ(x, y, rad, mid_col, 0.85) for x, y, rad in mid]
    g += [circ(x, y, rad, cream_col) for x, y, rad in cream]
    for x, y, rad in cream:  # warm light on the crowns, lavender in the folds
        for _ in range(5):
            g.append(stroke(x + r.uniform(-rad, rad) * 0.6, y + r.uniform(-rad, rad * 0.4) * 0.6, r.uniform(8, 22), r.uniform(3, 8), r.uniform(-30, 30),
                            r.choice(["#fdf7e4", "#efe6cf", "#fbf3dc"]), r.uniform(0.5, 0.9)))
    for x, y, rad in shade:
        for _ in range(4):
            g.append(stroke(x + r.uniform(-rad, rad) * 0.7, y + r.uniform(-rad, rad) * 0.7, r.uniform(12, 34), r.uniform(4, 10), r.uniform(-25, 25),
                            r.choice(["#8ea6c6", "#b2c3d6", "#a9bbd4", "#c9d4dc"]), r.uniform(0.3, 0.6)))
    return '<g filter="url(#brushCloud)">' + "".join(g) + "</g>"
body.append(cloud(  # the great cumulus left of the mountain
    [(470, 168, 30), (505, 186, 34), (540, 162, 36), (575, 150, 40), (610, 140, 44), (650, 126, 44), (674, 150, 34), (560, 200, 40),
     (610, 196, 44), (650, 190, 40), (500, 216, 30), (470, 206, 26), (445, 190, 20)],
    [(482, 160, 22), (545, 150, 26), (600, 136, 32), (585, 176, 26)],
    [(655, 112, 34), (673, 128, 26), (640, 100, 24), (626, 126, 22), (458, 150, 18), (450, 168, 16), (586, 166, 15), (600, 150, 13), (522, 226, 11)], seed=5))
body.append(cloud(  # right
    [(1180, 126, 30), (1215, 122, 36), (1255, 136, 34), (1295, 150, 32), (1335, 160, 30), (1375, 170, 30), (1410, 176, 28), (1240, 166, 30), (1290, 180, 26), (1345, 190, 22)],
    [(1230, 140, 24), (1300, 162, 22), (1350, 172, 20), (1270, 150, 22)],
    [(1196, 104, 27), (1226, 98, 28), (1176, 120, 17), (1254, 112, 27), (1284, 126, 25), (1314, 140, 23), (1346, 150, 22), (1378, 158, 22), (1410, 166, 22), (1238, 126, 20)],
    shade_col="#a3b9cc", seed=6))
body.append(cloud([(1300, 26, 24), (1350, 42, 26), (1392, 52, 22)], [], [(1290, 8, 26), (1326, 2, 30), (1366, 14, 32), (1404, 28, 30), (1345, 28, 22), (1340, -22, 30), (1386, -14, 34)], shade_col="#a3b9cc", seed=7))
body.append(cloud([(1020, 18, 16), (1040, 28, 12)], [], [(1010, 8, 16), (1030, 4, 20), (1048, 22, 13)], seed=8))
body.append(cloud([(66, 18, 14), (90, 22, 10), (318, -52, 18), (352, -50, 14)], [], [(56, 10, 14), (76, 6, 13), (96, 14, 9), (300, -60, 17), (330, -68, 22), (362, -60, 16), (386, -54, 10)], seed=9))

# ------------------------------------------------------------------ far ridge on the right
FAR = [(1150, 300), (1195, 152), (1207, 145), (1225, 155), (1262, 180), (1292, 200), (1330, 215), (1440, 232), (1440, 300)]
body.append(face(FAR, "#5f7895", [strokes(FAR, 90, 40, 12, (20, 60), (2, 6), ["#75889f", "#4f6f9a", "#8795a8", "#566b88"], 11)]))

# ------------------------------------------------------------------ the wedge peak, mid left
WEDGE_SH = [(265, 155), (250, 180), (225, 215), (200, 245), (200, 335), (312, 335), (300, 270), (285, 215), (278, 180)]
WEDGE_LT = [(265, 155), (300, 165), (350, 185), (440, 200), (462, 222), (520, 245), (565, 268), (565, 335), (312, 335), (300, 270), (285, 215), (278, 180)]
RIDGE_W = [(265, 155), (300, 165), (350, 185), (440, 200), (462, 222), (520, 245)]
body.append(face(WEDGE_SH, "#43668e", [strokes(WEDGE_SH, 80, 112, 10, (20, 70), (2, 6), ["#3e5b87", "#4a6f99", "#55789f", "#38557f"], 12)]))
body.append(face(WEDGE_LT, "#7d8fa3", [
    strokes(WEDGE_LT, 190, 20, 9, (20, 80), (2, 6), ["#8193a5", "#6b8094", "#9a887a", "#838b8e", "#5b7188", "#96a3b0", "#4d6d93"], 13),
    strokes(WEDGE_LT, 70, 20, 8, (14, 50), (2, 6), ["#c8742a", "#d98a3a", "#a86a3a", "#b9763a"], 14, (0.5, 0.9),
            accept=lambda x, y: 0.95 if 2 < y - lerp_line(RIDGE_W, x) < 22 else (0.3 if 70 < y - lerp_line(RIDGE_W, x) < 95 else 0.02)),
]))
FOOT = [(425, 335), (440, 300), (468, 276), (500, 263), (540, 276), (565, 292), (565, 335)]
body.append(face(FOOT, "#44638f", [strokes(FOOT, 40, 150, 14, (14, 40), (2, 5), ["#3e5a85", "#4f6f99", "#5a7aa3"], 15)]))

# ------------------------------------------------------------------ the mountain
EDGE_L = [(460, 297), (515, 250), (565, 210), (615, 165), (640, 150), (685, 115), (710, 75), (737, 0), (752, -40), (775, -70), (800, -82)]
EDGE_R = [(800, -82), (830, -62), (855, -30), (880, 10), (930, 30), (995, 48), (1070, 100), (1140, 133), (1200, 150), (1230, 170), (1266, 200)]
SPLIT = [(800, -82), (806, 0), (840, 70), (868, 140), (880, 210), (882, 302)]  # where shadow meets light
M_SH = EDGE_L + SPLIT[1:] + [(460, 302)]
M_LT = EDGE_R + [(1266, 302)] + SPLIT[::-1][:-1]
body.append(face(M_SH, "url(#shadowFace)", [
    strokes(M_SH, 300, 112, 9, (26, 110), (2, 7), ["#3a5682", "#46689a", "#4d72a3", "#35507a", "#5a7fae", "#415f8d"], 21, (0.22, 0.55)),
    strokes(M_SH, 40, 118, 8, (30, 90), (2, 5), ["#6c8fb8", "#7b9cc0"], 22, (0.2, 0.4)),
]))
HOT = [(806, -30), (880, 8), (962, 58), (1004, 130), (962, 204), (900, 172), (862, 92)]  # the orange shoulder
def orange_p(x, y):
    d = y - lerp_line(EDGE_R, x)
    if inside(HOT, x, y):
        return 0.75
    if 3 < d < 30:
        return 0.8
    return 0.05
body.append(face(M_LT, "#a3a4a2", [
    strokes(M_LT, 460, 48, 14, (18, 90), (2, 7), ["#c4c3bd", "#b0aea8", "#989a9b", "#808688", "#6b7686", "#d3d0c4", "#8d9299"], 23, (0.35, 0.8)),
    strokes(M_LT, 70, 55, 12, (20, 70), (3, 8), ["#556378", "#4a5a78", "#5b6980", "#4f6f9a"], 24, (0.3, 0.65), accept=lambda x, y: 0.9 if x > 1080 and y > 190 else 0.3),
    strokes(M_LT, 230, 50, 14, (12, 56), (2, 7), ["#c8772e", "#b86a2c", "#a28369", "#986e4f", "#d98a3a", "#c06f2b"], 25, (0.5, 0.92), accept=orange_p),
    strokes(M_LT, 50, 52, 10, (20, 70), (2, 5), ["#e3ded0", "#d9d5c8"], 26, (0.4, 0.7)),
]))
body.append('<rect x="-40" y="238" width="1480" height="70" fill="url(#haze)"/>')

# ------------------------------------------------------------------ near left ridge
RIDGE = [(-40, 80), (0, 102), (30, 118), (60, 150), (150, 210), (210, 235), (280, 280), (340, 320), (365, 362), (-40, 362)]
body.append(face(RIDGE, "#a8a195", [
    strokes(RIDGE, 380, 52, 9, (30, 120), (2, 7), ["#b9b2a4", "#c6c0ae", "#9d9d9b", "#8b8b8b", "#7f8286", "#d0cab8", "#a39c90"], 31, (0.3, 0.75)),
    strokes(RIDGE, 60, 50, 8, (30, 90), (3, 8), ["#7f807f", "#6c7478", "#5c6969"], 32, (0.3, 0.6), accept=lambda x, y: 0.9 if y > 300 or x < 40 else 0.15),
    strokes([(120, 225), (180, 232), (200, 290), (150, 290)], 16, 55, 8, (14, 40), (2, 5), ["#b9763a", "#c8823f", "#a86a3a"], 33, (0.5, 0.85)),
]))

# ------------------------------------------------------------------ the plain
MEADOW = [(352, 362), (372, 326), (410, 310), (470, 301), (560, 299), (700, 303), (900, 300), (1160, 297), (1160, 362)]
body.append(face(MEADOW, "#c2742f", [
    strokes(MEADOW, 430, 0, 8, (14, 70), (1.5, 4), ["#c67c34", "#be7435", "#d98a3a", "#ad6b35", "#976840", "#e09a45", "#8a5a34", "#cf8437"], 41, (0.4, 0.9)),
]))
body.append('<g filter="url(#brush)">'
            + poly([(578, 338), (606, 322), (700, 330), (700, 362), (566, 362)], "#2f3663", 0.85)   # the building's shadow
            + poly([(880, 322), (1000, 318), (1130, 321), (1130, 326), (1000, 324), (880, 329)], "#cdbf9f", 0.75)  # a pale road
            + "</g>")

# ------------------------------------------------------------------ low white buildings, bottom left
body.append('<g filter="url(#brushFine)">'
            + poly([(248, 352), (276, 324), (322, 321), (332, 352)], "#dfe3df") + poly([(322, 321), (346, 317), (352, 352), (332, 352)], "#5f7490")
            + poly([(346, 330), (420, 311), (426, 318), (362, 341)], "#f1efe2") + poly([(352, 337), (424, 319), (428, 352), (352, 352)], "#3f5a85")
            + poly([(366, 322), (386, 317), (387, 322), (367, 327)], "#2f3663") + poly([(262, 340), (300, 334), (302, 352), (256, 352)], "#b9c2c6")
            + "</g>")

# ------------------------------------------------------------------ dark slope, right
SLOPE = [(1118, 362), (1142, 300), (1160, 280), (1190, 245), (1230, 220), (1290, 200), (1360, 200), (1385, 185), (1440, 156), (1440, 362)]
GRASS = [(1128, 362), (1150, 340), (1180, 322), (1240, 290), (1300, 262), (1360, 235), (1440, 196), (1440, 362)]
body.append(face(SLOPE, "#2c3558", [strokes(SLOPE, 130, -28, 12, (20, 80), (2, 7), ["#262744", "#323353", "#3a4268", "#2d355a", "#414a70"], 51)]))
body.append(face(GRASS, "#a75e28", [strokes(GRASS, 300, -26, 12, (14, 64), (1.5, 5), ["#b76a2a", "#aa622e", "#c8772e", "#995128", "#8a4a26", "#d08a3a", "#734830"], 52, (0.4, 0.9))]))

# ------------------------------------------------------------------ the citadel
CREAM, CREAM2, PALE, NAVY = "#f3ebd4", "#e7dfc8", "#b4c6d2", "#2d3560"
b = []
def spire(x0, x1, top, base, foot_l, foot_r, seed):
    """A swept spire: a narrow shaft that flares to a wide foot, a dark slot up the lit edge."""
    r = random.Random(seed)
    mid = top + (base - top) * 0.52
    out = [f'<path d="M {foot_l} {base} C {x0 - 18} {base - 28}, {x0 - 1} {mid + 44}, {x0} {mid} L {x0} {top + 1} L {x1} {top} '
           f'C {x1 + 3} {top + (base - top) * 0.53:.0f}, {x1 + 25} {base - 42}, {foot_r} {base} Z" fill="url(#cream)"/>',
           f'<path d="M {foot_l} {base} C {x0 - 18} {base - 28}, {x0 - 1} {mid + 44}, {x0} {mid} L {x0} {top + 1} L {x0 + 5} {top + 1} L {x0 + 5} {base} Z" fill="{PALE}"/>',
           f'<path d="M {foot_l + 14} {base} C {x0 - 12} {base - 20}, {x0 - 2} {base - 44}, {x0 + 1} {base - 70} L {x0 + 1} {base} Z" fill="#dbe7ea" opacity="0.8"/>',
           f'<rect x="{x0 + 3.5}" y="{top + 11}" width="{5 if x1 - x0 > 26 else 4}" height="{base - top - 11}" fill="{NAVY}"/>',
           f'<rect x="{x0 + 1}" y="{top + 3}" width="6" height="6" fill="#fffdf4"/>']
    for _ in range(26):  # faint weathering down the lit face
        y = r.uniform(top + 20, base - 6); t = (y - top) / (base - top)
        x = r.uniform(x0 + 12, x1 + (foot_r - x1) * t ** 2.2 - 6)
        out.append(stroke(x, y, r.uniform(10, 30), r.uniform(1, 2.4), 84 - 30 * t, r.choice(["#ddd5bd", "#fbf5e2", "#e9e1c9"]), r.uniform(0.35, 0.7)))
    return out
# the base: a low battered block, left face in shadow, right face in the sun
b += [poly([(590, 336), (606, 320), (675, 258), (800, 258), (808, 331)], "url(#baseShade)"),
      poly([(752, 262), (792, 262), (800, 326), (748, 326)], "#cfe0e6", 0.55),
      poly([(665, 274), (736, 274), (735, 288), (650, 288)], "#3b4f77"), poly([(632, 302), (722, 302), (720, 324), (608, 324)], "#333867"),
      poly([(800, 258), (1020, 262), (1031, 300), (808, 331)], "#f1ead7"),
      poly([(808, 318), (1031, 292), (1031, 300), (808, 331)], "#d9cfb4", 0.8),
      poly([(672, 254), (800, 254), (1023, 258), (1021, 264), (800, 260), (674, 260)], "#ece8d8"),
      poly([(925, 272), (990, 274), (993, 300), (929, 305)], "#2e335e"),
      poly([(997, 291), (1024, 290), (1026, 299), (998, 301)], "#5a3a3a"),
      poly([(835, 271), (851, 271), (851, 280), (835, 280)], "#3b4f77")]
for i, x in enumerate((936, 947, 958, 969, 980)):
    b.append(poly([(x, 274), (x + 5, 274), (x + 6, 302), (x + 1, 303)], "#4a5fa0", 0.7 if i % 2 else 0.45))
for x in (850, 880, 905):
    b.append(poly([(x, 262), (x + 1.4, 262), (x + 3, 322 - (x - 808) * 0.12), (x + 1.6, 322 - (x - 808) * 0.12)], "#cfc7b0", 0.8))
b += [poly([(860, 286), (900, 285), (902, 310), (862, 314)], "#e6dec6", 0.9), poly([(812, 290), (846, 289), (848, 318), (813, 322)], "#e9e2cb", 0.9)]
b += spire(885, 910, 60, 259, 858, 992, 61)
b += spire(745, 775, 30, 257, 705, 882, 62)
# dome and dish
b += ['<path d="M 521 306 A 25 23 0 0 1 571 306 Z" fill="#f3ecd8"/>', '<path d="M 521 306 A 25 23 0 0 1 536 286 A 30 30 0 0 0 548 306 Z" fill="#a9bccd"/>',
      poly([(512, 306), (578, 306), (574, 311), (516, 311)], "#3f5a85", 0.7),
      '<ellipse cx="1046" cy="315" rx="7" ry="7.5" fill="#8d95a3"/>', '<rect x="1045.3" y="321" width="1.4" height="12" fill="#5a5f6b"/>']
for x in (1085, 1098, 1111, 1124, 1137):
    b.append(f'<rect x="{x}" y="326" width="1" height="6" fill="#6b5a4a"/>')
body.append('<g filter="url(#brushFine)">' + "".join(b) + "</g>")

# ------------------------------------------------------------------ assemble
head = f'''<defs>
<linearGradient id="sky" gradientUnits="userSpaceOnUse" x1="0" y1="{TOP}" x2="0" y2="{H}">
  <stop offset="0" stop-color="#3f6a9f"/><stop offset="0.35" stop-color="#4b76a8"/><stop offset="0.7" stop-color="#5a88b0"/><stop offset="1" stop-color="#8fb0c8"/>
</linearGradient>
<linearGradient id="hazeRight" gradientUnits="userSpaceOnUse" x1="820" y1="0" x2="1400" y2="0">
  <stop offset="0" stop-color="#93adc3" stop-opacity="0"/><stop offset="1" stop-color="#93adc3" stop-opacity="0.62"/>
</linearGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#b9cbd8" stop-opacity="0"/><stop offset="1" stop-color="#b9cbd8" stop-opacity="0.3"/>
</linearGradient>
<linearGradient id="shadowFace" gradientUnits="userSpaceOnUse" x1="0" y1="-80" x2="0" y2="302">
  <stop offset="0" stop-color="#3c5884"/><stop offset="0.7" stop-color="#405f8b"/><stop offset="1" stop-color="#5a7699"/>
</linearGradient>
<linearGradient id="cream" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f7f0db"/><stop offset="1" stop-color="{CREAM2}"/></linearGradient>
<linearGradient id="baseShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#93a8b8"/><stop offset="1" stop-color="#5c728d"/></linearGradient>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="26"/></filter>
<filter id="brush" x="-3%" y="-6%" width="106%" height="112%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed="4" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="brushSky" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.02 0.06" numOctaves="3" seed="8" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="brushFine" x="-3%" y="-6%" width="106%" height="112%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="9" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="brushCloud" x="-10%" y="-20%" width="120%" height="140%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="4" seed="2" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="0.7"/>
</filter>
<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="2" seed="5" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.08  0 0 0 0 0.11  0 0 0 0 0.2  0 0 0 1.5 -0.62"/>
</filter>
<filter id="grainLight" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="31" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 0.96  0 0 0 0 0.86  0 0 0 1.4 -0.66"/>
</filter>
{"".join(defs)}
</defs>'''
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {TOP} {W} {H - TOP}" preserveAspectRatio="xMidYMax slice" role="img" '
       f'aria-label="A painted valley: a pale twin-spired citadel below a mountain, orange grass, a blue sky.">\n{head}\n'
       + "\n".join(body)
       + f'\n<rect y="{TOP}" width="{W}" height="{H - TOP}" filter="url(#grain)" opacity="0.3"/>'
       + f'\n<rect y="{TOP}" width="{W}" height="{H - TOP}" filter="url(#grainLight)" opacity="0.22"/>\n</svg>\n')
open(sys.argv[1], "w").write(svg)
print(len(svg), "bytes,", svg.count("<polygon"), "strokes")
