"""Puts a flat screen image (e.g. the English Idle screen) into the screen of a device render,
in perspective, without touching a single pixel of the device outside the screen.

    python3 insert-screen.py fit  --base 1--desktop.png --ref 1--desktop-hover.png --out geom-1.json
    python3 insert-screen.py put  --geom geom-1.json --base 1--desktop.png --screen Idle.png --out 1--desktop-hover-en
    python3 insert-screen.py check --geom geom-1.json --base 1--desktop.png --ref 1--desktop-hover.png --out check-1

fit    learns the screen from a pair the site already has: the device with the logo screen (base) and
       the same device with the Russian screen (ref). The pixels that differ are the screen. Its four
       sides are fitted as straight lines (rounded corners and the notch are left out of the fit), the
       corners become a homography from flat screen space, and the corner radius and the camera
       hole are measured in that flat space. geom.json is resolution-free: it works for any size of
       the same render (the site's 890x1330 and the 1338x2000 source).
put    pins the four corners of the screen image to the four screen corners (as the Russian version was
       made), warps it at 4x supersampling and composites it only inside the screen mask (anti-aliased
       edge, camera hole kept). Writes <out>.png (256 colours), .webp and .avif like the site's
       files, or with --master one full-colour PNG.
check  round trip on the Russian version: unwarps its screen to flat, warps it back and reports the
       error against the original, plus a flat preview to judge the aspect ratio.
"""
import argparse
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SS = 4  # supersampling for the warp and the mask edge


# ---------------------------------------------------------------- geometry

def homography(src, dst):
    """3x3 H with dst ~ H @ src for four point pairs."""
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.asarray(A, float))
    H = vt[-1].reshape(3, 3)
    return H / H[2, 2]


def apply_h(H, pts):
    p = np.c_[pts, np.ones(len(pts))] @ H.T
    return p[:, :2] / p[:, 2:3]


def fit_line(pts):
    """Total least squares: point on line and unit direction."""
    c = pts.mean(0)
    _, _, vt = np.linalg.svd(pts - c)
    return c, vt[0]


def intersect(l1, l2):
    (p, d), (q, e) = l1, l2
    t = np.linalg.solve(np.array([d, -e]).T, q - p)
    return p + t[0] * d


# ---------------------------------------------------------------- masks

def components(mask):
    """Labels of 4-connected components (numpy flood fill, fine for one image)."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    n = 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]:
            continue
        n += 1
        stack = [(y0, x0)]
        lab[y0, x0] = n
        while stack:
            y, x = stack.pop()
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    stack.append((yy, xx))
    return lab, n


def screen_mask(base, ref, thr):
    a = np.asarray(base.convert("RGBA")).astype(int)
    b = np.asarray(ref.convert("RGBA")).astype(int)
    diff = (np.abs(a - b)[..., :3].sum(-1) > thr) & (a[..., 3] > 200)
    m = Image.fromarray((diff * 255).astype(np.uint8))
    m = m.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))  # close specks
    small = m.resize((m.width // 4, m.height // 4), Image.BOX)
    sm = np.asarray(small) > 127
    lab, n = components(sm)
    if not n:
        sys.exit("no screen difference found")
    biggest = 1 + int(np.argmax([(lab == i).sum() for i in range(1, n + 1)]))
    keep = Image.fromarray(((lab == biggest) * 255).astype(np.uint8)).resize(m.size, Image.NEAREST)
    full = np.asarray(m) > 127
    near = np.asarray(keep.filter(ImageFilter.MaxFilter(9))) > 127
    return full & near


def boundary(mask):
    m = Image.fromarray((mask * 255).astype(np.uint8))
    inner = np.asarray(m.filter(ImageFilter.MinFilter(3))) > 127
    ys, xs = np.nonzero(mask & ~inner)
    return np.c_[xs, ys].astype(float)


def rounded_rect_flat(w, h, r, scale):
    img = Image.new("L", (int(w * scale), int(h * scale)), 0)
    ImageDraw.Draw(img).rounded_rectangle([0, 0, w * scale - 1, h * scale - 1], radius=r * scale, fill=255)
    return img


# ---------------------------------------------------------------- fit

def fit(a):
    base, ref = Image.open(a.base).convert("RGBA"), Image.open(a.ref).convert("RGBA")
    mask = screen_mask(base, ref, a.thr)
    ys, xs = np.nonzero(mask)
    pts = boundary(mask)
    # rough corners: extreme points along the diagonals of the screen
    c = np.array([xs.mean(), ys.mean()])
    s, d = pts.sum(1), pts[:, 0] - pts[:, 1]
    rough = [pts[np.argmin(s)], pts[np.argmax(d)], pts[np.argmax(s)], pts[np.argmin(d)]]  # TL TR BR BL
    lines = []
    for i in range(4):
        p, q = rough[i], rough[(i + 1) % 4]
        seg = q - p
        L = np.linalg.norm(seg)
        u = seg / L
        nrm = np.array([-u[1], u[0]])
        t = (pts - p) @ u
        off = (pts - p) @ nrm
        sel = (t > 0.18 * L) & (t < 0.82 * L) & (np.abs(off) < 0.06 * L)  # straight middle part only
        side = pts[sel]
        for _ in range(4):  # trim the notch and noise: refit on the closest 90 %
            cc, dd = fit_line(side)
            dist = np.abs((side - cc) @ np.array([-dd[1], dd[0]]))
            side = side[dist <= max(np.quantile(dist, 0.9), 0.75)]
        lines.append(fit_line(side))
    corners = np.array([intersect(lines[(i - 1) % 4], lines[i]) for i in range(4)])  # TL TR BR BL
    # flat screen space: aspect from the side lengths (refined by the caller with --aspect if known)
    wpx = (np.linalg.norm(corners[1] - corners[0]) + np.linalg.norm(corners[2] - corners[3])) / 2
    hpx = (np.linalg.norm(corners[3] - corners[0]) + np.linalg.norm(corners[2] - corners[1])) / 2
    aspect = a.aspect or (wpx / hpx)
    FW, FH = 1000.0, 1000.0 / aspect
    flat = np.array([[0, 0], [FW, 0], [FW, FH], [0, FH]])
    H = homography(flat, corners)
    Hi = np.linalg.inv(H)
    # mask back in flat space: corner radius and holes (camera)
    yy, xx = np.mgrid[0:mask.shape[0], 0:mask.shape[1]]
    fl = apply_h(Hi, np.c_[xx.ravel(), yy.ravel()].astype(float)).reshape(mask.shape + (2,))
    inside = (fl[..., 0] >= 0) & (fl[..., 0] <= FW) & (fl[..., 1] >= 0) & (fl[..., 1] <= FH)
    best = None
    for r in np.arange(0, 320, 2.0):
        rr = rounded_rect_flat(FW, FH, r, 1)
        rm = np.asarray(rr) > 127
        fx = np.clip(fl[..., 0].astype(int), 0, rm.shape[1] - 1)
        fy = np.clip(fl[..., 1].astype(int), 0, rm.shape[0] - 1)
        pred = inside & rm[fy, fx]
        iou = (pred & mask).sum() / (pred | mask).sum()
        if best is None or iou > best[0]:
            best = (iou, r, pred)
    iou, radius, pred = best
    # holes: inside the predicted screen, not in the observed mask, compact and dark in base (camera)
    holes = []
    hole_mask = pred & ~Image_dilate(mask, 3)
    lab, n = components(hole_mask)
    b = np.asarray(base.convert("L")).astype(int)
    for i in range(1, n + 1):
        hy, hx = np.nonzero(lab == i)
        if len(hx) < 30:
            continue
        w_, h_ = np.ptp(hx) + 1, np.ptp(hy) + 1
        if 0.6 < w_ / h_ < 1.6 and len(hx) > 0.5 * w_ * h_ and b[hy, hx].mean() < 60:
            cf = apply_h(Hi, np.array([[hx.mean(), hy.mean()]]))[0]
            edge = apply_h(Hi, np.array([[hx.mean() + w_ / 2, hy.mean()], [hx.mean(), hy.mean() + h_ / 2]]))
            rad = float(np.mean(np.linalg.norm(edge - cf, axis=1))) + 1.0
            holes.append({"cx": float(cf[0]), "cy": float(cf[1]), "r": rad})
    geom = {
        "source_size": list(base.size), "corners": corners.round(3).tolist(), "flat": [FW, FH],
        "aspect_wh": aspect, "radius_flat": float(radius), "holes_flat": holes, "iou": float(iou),
        "_note": "corners TL TR BR BL in source pixels; flat space is FW x FH; radius and holes in flat units",
    }
    json.dump(geom, open(a.out, "w"), indent=1)
    print(f"{a.out}: corners {np.round(corners, 1).tolist()}, aspect w/h {aspect:.4f}, radius {radius}, "
          f"holes {len(holes)}, mask IoU {iou:.4f}")


def Image_dilate(mask, k):
    m = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(k))
    return np.asarray(m) > 127


# ---------------------------------------------------------------- put

def flat_mask(geom, scale):
    FW, FH = geom["flat"]
    m = rounded_rect_flat(FW, FH, geom["radius_flat"], scale)
    d = ImageDraw.Draw(m)
    for h in geom["holes_flat"]:
        d.ellipse([(h["cx"] - h["r"]) * scale, (h["cy"] - h["r"]) * scale,
                   (h["cx"] + h["r"]) * scale, (h["cy"] + h["r"]) * scale], fill=0)
    return m


def warp_into(img_flat, geom, size, pad=8):
    """Warp a flat image onto the device image of `size` (corner pin). Returns RGB, or L for a mask.

    The flat image is extended by `pad` edge pixels before warping, so the warped colour is valid a
    little beyond the screen edge; the shape is set only by the mask. Warping is done without alpha:
    resampling a transparent edge would unpremultiply near-zero alpha into noisy colours.
    """
    W, Hh = size
    sx = W / geom["source_size"][0]
    corners = np.array(geom["corners"]) * sx
    mode = "L" if img_flat.mode == "L" else "RGB"
    src = img_flat if mode == "L" else rgb_on_black(img_flat)
    fw, fh = src.size
    if pad and mode == "RGB":
        src = Image.fromarray(np.pad(np.asarray(src), ((pad, pad), (pad, pad), (0, 0)), mode="edge"))
    else:
        pad = 0
    big = (W * SS, Hh * SS)
    quad = np.array([[pad, pad], [pad + fw, pad], [pad + fw, pad + fh], [pad, pad + fh]], float)
    Hm = homography(quad, corners * SS)
    Hinv = np.linalg.inv(Hm)
    coeffs = (Hinv / Hinv[2, 2]).ravel()[:8].tolist()
    out = src.transform(big, Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    return out.resize(size, Image.LANCZOS)


def rgb_on_black(img):
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (0, 0, 0, 255))
        return Image.alpha_composite(bg, img).convert("RGB")
    return img.convert("RGB")


def composite(base, screen_rgb, mask_l):
    b = np.asarray(base.convert("RGBA")).astype(float)
    s = np.asarray(screen_rgb.convert("RGB")).astype(float)
    m = (np.asarray(mask_l).astype(float) / 255.0)[..., None]
    out = b.copy()
    out[..., :3] = b[..., :3] * (1 - m) + s[..., :3] * m
    return Image.fromarray(out.round().clip(0, 255).astype(np.uint8), "RGBA")


def device_mask(geom, size):
    FW, FH = geom["flat"]
    return warp_into(flat_mask(geom, SS), geom, size)


def fit_cover(screen, aspect):
    """Crop the screen image to the flat aspect (centre, never stretch)."""
    w, h = screen.size
    if abs(w / h - aspect) < 1e-3:
        return screen
    if w / h > aspect:
        nw = round(h * aspect)
        x0 = (w - nw) // 2
        return screen.crop((x0, 0, x0 + nw, h))
    nh = round(w / aspect)
    y0 = (h - nh) // 2
    return screen.crop((0, y0, w, y0 + nh))


def save_all(img, out, master=False):
    """Site set as the site has it: palette PNG (libimagequant, as pngquant; full colour if it is not
    installed), WebP and AVIF at about the sizes of the current hover files. master: full-colour PNG only."""
    if master:
        img.save(out + ".png", optimize=True)
        print("wrote", out + ".png", img.size)
        return
    try:
        import imagequant  # pip install imagequant
        imagequant.quantize_pil_image(img, dithering_level=1.0, max_colors=256).save(out + ".png", optimize=True)
    except ImportError:
        print("imagequant not installed: PNG saved in full colour (pip install imagequant for a 256-colour PNG)")
        img.save(out + ".png", optimize=True)
    img.save(out + ".webp", quality=90, method=6)
    img.save(out + ".avif", quality=65)
    print("wrote", out + ".png/.webp/.avif", img.size)


def put(a):
    geom = json.load(open(a.geom))
    base = Image.open(a.base).convert("RGBA")
    screen = rgb_on_black(Image.open(a.screen))
    if a.cover:  # crop to the measured aspect instead of pinning the four corners
        screen = fit_cover(screen, geom["aspect_wh"])
    warped = warp_into(screen, geom, base.size)
    mask = device_mask(geom, base.size)
    out = composite(base, warped, mask)
    save_all(out, a.out, a.master)


# ---------------------------------------------------------------- check

def unwarp(img, geom, flat_w):
    FW, FH = geom["flat"]
    fw, fh = flat_w, round(flat_w * FH / FW)
    sx = img.size[0] / geom["source_size"][0]
    corners = np.array(geom["corners"]) * sx
    Hm = homography(np.array([[0, 0], [fw, 0], [fw, fh], [0, fh]], float), corners)
    coeffs = (Hm / Hm[2, 2]).ravel()[:8].tolist()
    return rgb_on_black(img).transform((fw, fh), Image.PERSPECTIVE, coeffs, Image.BICUBIC)


def check(a):
    geom = json.load(open(a.geom))
    base = Image.open(a.base).convert("RGBA")
    ref = Image.open(a.ref).convert("RGBA")
    flat = unwarp(ref, geom, 1200)
    flat.save(a.out + "-flat.png")
    back = warp_into(flat, geom, base.size)
    mask = device_mask(geom, base.size)
    out = composite(base, back, mask)
    out.save(a.out + "-roundtrip.png")
    m = np.asarray(mask) > 250
    err = np.abs(np.asarray(out).astype(int) - np.asarray(ref).astype(int))[..., :3].mean(-1)
    outside = np.asarray(mask) == 0
    same = np.abs(np.asarray(out).astype(int) - np.asarray(base).astype(int))[..., :4].max()
    print(f"round trip inside the screen: mean abs error {err[m].mean():.2f} / 255, p99 {np.quantile(err[m], 0.99):.1f}; "
          f"outside the screen the device equals the base: {np.abs(np.asarray(out)[outside].astype(int) - np.asarray(base)[outside].astype(int)).max() == 0}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fit"); f.add_argument("--base", required=True); f.add_argument("--ref", required=True)
    f.add_argument("--out", required=True); f.add_argument("--thr", type=int, default=12)
    f.add_argument("--aspect", type=float, help="physical screen width/height if known (e.g. 9/19.5)")
    p = sub.add_parser("put"); p.add_argument("--geom", required=True); p.add_argument("--base", required=True)
    p.add_argument("--screen", required=True); p.add_argument("--out", required=True)
    p.add_argument("--master", action="store_true", help="write one full-colour PNG (for Figma) instead of the site set")
    p.add_argument("--cover", action="store_true", help="crop the screen image to the measured aspect instead of pinning its corners")
    c = sub.add_parser("check"); c.add_argument("--geom", required=True); c.add_argument("--base", required=True)
    c.add_argument("--ref", required=True); c.add_argument("--out", required=True)
    a = ap.parse_args()
    {"fit": fit, "put": put, "check": check}[a.cmd](a)


if __name__ == "__main__":
    main()
