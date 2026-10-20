"""把结果渲染图整理成滑动对比用的 RGBA webp（public/img/results/aligned/）。

用法（在仓库根目录直接运行，无需参数）:
    python scripts/align_results.py

- 源图全部按 RGBA 读取，不合成到白底上，输出保留透明通道。
- 同一集合内所有图尺寸相同（同一相机、同一帧）时，不做配准：
  取所有图 alpha > 20 的并集包围盒，四周各留 4% 边距，用同一个框裁剪全部图，
  再用同一缩放系数把最长边压到 1100 以内（LANCZOS），三者始终逐像素对齐。
- 尺寸不同时，回退到包围盒配准：以 ours 为参考，把各方法的包围盒缩放并平移到 ours 的包围盒上。
- 输出 webp quality 86；本次运行未写入的旧文件会被删除。
"""
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[1]
COMP = Path('D:/Code/UDF-Projects/Figure/image/Comparaison')
OUT = REPO / 'public' / 'img' / 'results' / 'aligned'

ALPHA_THR = 20
PAD_RATIO = 0.04
MAX_SIDE = 1100
WEBP_QUALITY = 86

# 方法 id -> 源文件名中的标记（用于模板）
TAGS_STD = {
    'gt': 'GroundTruth', 'ours': 'OffsetAxis', 'capudf': 'CAPUDF',
    'dualmesh': 'DualMeshUDF', 'meshudf': 'MeshUDF', 'geoudf': 'GeoUDF',
    'dcudf': 'DCUDF', 'dcudf2': 'DCUDF2', 'mind': 'MIND',
}

# 集合名 -> 源目录 + 每个方法的源文件名（explicit 映射，缺失的方法会被跳过并报告）
SETS = {
    'copyroom': {
        'dir': COMP / '3dScene/256/copyroom',
        # GT: the wireless render is the light one (the main-folder GT is shaded almost black)
        'files': {**{m: f'copyroom_{t}_256.png' for m, t in TAGS_STD.items()}, 'gt': 'wireless/copyroom_GroundTruth_256.png'},
    },
    'car': {
        'dir': COMP / 'shapenetcar_200/256/5c8f71dcfe980f714f3a54559bf4cbcb_256',
        'files': {m: f'5c8f71dcfe980f714f3a54559bf4cbcb_{t}_256.png' for m, t in TAGS_STD.items()},
    },
    'garment': {
        'dir': COMP / 'deepfashion/18-9',
        'files': {
            **{m: f'18-9_{t}_128.png' for m, t in TAGS_STD.items() if m != 'gt'},
            'gt': '18-9_GroundTruth.png',
        },
    },
    'sharp020': {
        'dir': COMP / 'SharpEdge/ABC_020',
        'files': {
            **{m: f'ABC_020_{t}_sharp.png' for m, t in TAGS_STD.items() if m not in ('gt', 'ours')},
            'gt': 'ABC_020_GT_sharp.png',
            'ours': 'ABC_020_OffsetAxis_sharp.png',
        },
    },
    'nm007': {
        'dir': COMP / 'NonManifold/nmabc_007_5way',
        'files': {
            'gt': '01_nmabc_007_GroundTruth_nonmanifold.png',
            'dualmesh': '02_nmabc_007_DualMeshUDF_nonmanifold.png',
            'mind': '03_nmabc_007_MIND_nonmanifold.png',
            # ours = 三角面汤（triangle soup）结果，不是 UDF 结果 04_...
            'ours': '05_nmabc_007_OffsetAxisTriangleSoup_nonmanifold.png',
        },
    },
}


def load(path):
    """读取为 RGBA，保留原始透明通道，不做白底合成。"""
    return Image.open(path).convert('RGBA')


def bbox(im):
    """按 alpha > ALPHA_THR 计算不透明内容的包围盒 (x0, y0, x1, y1)。"""
    alpha = np.asarray(im)[..., 3]
    ys, xs = np.where(alpha > ALPHA_THR)
    if xs.size == 0:
        raise ValueError('图像中没有不透明像素')
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def place(im, canvas_size, xy):
    """把 im 直接替换粘贴到透明画布上。

    不使用 paste(mask=alpha)：对透明画布做带 mask 的粘贴会把 alpha 再乘一次
    alpha，导致半透明边缘变淡。替换粘贴可以原样保留像素与 alpha。
    """
    layer = Image.new('RGBA', canvas_size, (0, 0, 0, 0))
    layer.paste(im, xy)
    return layer


def cap_size(im):
    """最长边压到 MAX_SIDE 以内（只缩小不放大）。"""
    w, h = im.size
    s = min(1.0, MAX_SIDE / max(w, h))
    if s == 1.0:
        return im
    return im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)


def crop_union(imgs):
    """尺寸相同的一组图：用并集包围盒 + 4% 边距统一裁剪，再统一缩放。"""
    boxes = [bbox(im) for im in imgs.values()]
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes)
    y1 = max(b[3] for b in boxes)
    pad = round(PAD_RATIO * max(x1 - x0, y1 - y0))
    crop = (x0 - pad, y0 - pad, x1 + pad, y1 + pad)  # 越界部分由 PIL 填成透明
    print(f'    union bbox {(x0, y0, x1, y1)} pad {pad} crop {crop}')
    # 先统一裁剪，再统一缩放：同一个框、同一个系数，保证逐像素对齐
    out = {m: im.crop(crop) for m, im in imgs.items()}
    cw, ch = next(iter(out.values())).size
    s = min(1.0, MAX_SIDE / max(cw, ch))
    print(f'    crop {cw}x{ch} -> scale {s:.4f}')
    if s < 1.0:
        out = {m: im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
               for m, im in out.items()}
    return out


def register_to_ref(imgs):
    """尺寸不同时的回退路径：各方法的包围盒缩放、平移到 ours 的包围盒上。"""
    ref = imgs['ours']
    W, H = ref.size
    pad = round(PAD_RATIO * max(W, H))
    CW, CH = W + 2 * pad, H + 2 * pad
    rb = bbox(ref)
    rcx, rcy = (rb[0] + rb[2]) / 2 + pad, (rb[1] + rb[3]) / 2 + pad
    rw, rh = rb[2] - rb[0], rb[3] - rb[1]
    out = {'ours': place(ref, (CW, CH), (pad, pad))}
    for m, im in imgs.items():
        if m == 'ours':
            continue
        b = bbox(im)
        bw, bh = b[2] - b[0], b[3] - b[1]
        s = (rw / bw + rh / bh) / 2
        im2 = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        cx, cy = (b[0] + b[2]) / 2 * s, (b[1] + b[3]) / 2 * s
        out[m] = place(im2, (CW, CH), (round(rcx - cx), round(rcy - cy)))
        print(f'    {m}: scale {s:.3f} (w {rw / bw:.3f}, h {rh / bh:.3f})')
    # 配准画布也统一压到 MAX_SIDE 以内，与裁剪路径的输出尺寸一致
    return {m: cap_size(im) for m, im in out.items()}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    written = set()

    for name, spec in SETS.items():
        print(f'== {name}  ({spec["dir"]})')
        imgs, missing = {}, []
        for m, fname in spec['files'].items():
            p = spec['dir'] / fname
            if not p.exists():
                missing.append(m)
                continue
            imgs[m] = load(p)
        if 'ours' not in imgs:
            raise SystemExit(f'{name}: 缺少 ours 源文件，中止')
        if missing:
            print(f'    missing: {", ".join(missing)}')

        sizes = {im.size for im in imgs.values()}
        for m, im in imgs.items():
            a = np.asarray(im)[..., 3]
            if (a == 255).all():
                print(f'    WARNING {m}: 源图完全不透明（无透明背景）')
        if len(sizes) == 1:
            print(f'    sizes identical {next(iter(sizes))} -> identical-size crop path')
            out = crop_union(imgs)
        else:
            print(f'    sizes differ {sorted(sizes)} -> registration path')
            out = register_to_ref(imgs)

        for m, im in out.items():
            fn = f'{name}_{m}.webp'
            im.save(OUT / fn, 'WEBP', quality=WEBP_QUALITY)
            written.add(fn)
            print(f'    wrote {fn} {im.size[0]}x{im.size[1]}')

    for f in sorted(OUT.iterdir()):
        if f.is_file() and f.name not in written:
            f.unlink()
            print('removed stale', f.name)


if __name__ == '__main__':
    main()
