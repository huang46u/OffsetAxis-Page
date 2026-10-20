"""把结果渲染图整理成滑动对比用的 RGBA webp（public/img/results/aligned/）。

用法（在仓库根目录直接运行，无需参数）:
    python scripts/align_results.py

- 源图全部按 RGBA 读取，不合成到白底上，输出保留透明通道。
- 同一集合内所有图尺寸相同（同一相机、同一帧）时，不做配准：
  取所有图 alpha > 20 的并集包围盒，四周各留 4% 边距，用同一个框裁剪全部图，
  再用同一缩放系数把最长边压到 1100 以内（LANCZOS），三者始终逐像素对齐。
- 尺寸不同时，回退到包围盒配准：以 ours 为参考，把各方法的包围盒缩放并平移到 ours 的包围盒上。
- 输出 webp：默认 quality 86、最长边 1100；新集合在 SETS 中用 max_side / quality 覆盖。本次运行未写入的旧文件会被删除。
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

# 锐利边缘集合（SharpEdge/<model>/，文件名 <model>_<Tag>_sharp.png）
TAGS_SHARP = {
    'gt': 'GT', 'ours': 'OffsetAxis', 'capudf': 'CAPUDF', 'dualmesh': 'DualMeshUDF',
    'meshudf': 'MeshUDF', 'geoudf': 'GeoUDF', 'dcudf': 'DCUDF', 'dcudf2': 'DCUDF2', 'mind': 'MIND',
}
# 新增集合的尺寸/质量覆盖（用于控制体积）
NEW_KW = {'max_side': 900, 'quality': 82}


def sharp_set(model):
    return {
        'dir': COMP / 'SharpEdge' / model,
        'files': {m: f'{model}_{t}_sharp.png' for m, t in TAGS_SHARP.items()},
        **NEW_KW,
    }


def nm_set(n):
    """非流形：NonManifold/nmabc_<n>_5way/，忽略 00a/00b。"""
    p = f'nmabc_{n}'
    return {
        'dir': COMP / 'NonManifold' / f'{p}_5way',
        'files': {
            'gt': f'01_{p}_GroundTruth_nonmanifold.png',
            'dualmesh': f'02_{p}_DualMeshUDF_nonmanifold.png',
            'mind': f'03_{p}_MIND_nonmanifold.png',
            'ours_udf': f'04_{p}_OffsetAxis_nonmanifold.png',
            # ours = 三角面汤（triangle soup）结果，不是 UDF 结果 04_...
            'ours': f'05_{p}_OffsetAxisTriangleSoup_nonmanifold.png',
        },
        **NEW_KW,
    }


def qmdf_set(parent, name):
    """Q-MDF：QMDF/<parent>/<name>/，7 张图（网格线框 01-04，分片 05-07）。"""
    return {
        'dir': COMP / 'QMDF' / parent / name,
        'files': {
            'gt': f'01_{name}_input_mesh_wireframe.png',
            'dcudf': f'02_{name}_dcudf_input_wireframe.png',
            'mind': f'03_{name}_mind_input_wireframe.png',
            'ours': f'04_{name}_offsetaxis_input_wireframe.png',
            'ours_patch': f'05_{name}_offsetaxis_components.png',
            'dcudf_patch': f'06_{name}_dcudf_components.png',
            'mind_patch': f'07_{name}_mind_components.png',
        },
        **NEW_KW,
    }


# 集合名 -> 源目录 + 每个方法的源文件名（explicit 映射，缺失的方法会被跳过并报告）
# 可选键 max_side / quality 覆盖全局 MAX_SIDE / WEBP_QUALITY
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
    'sharp_020': sharp_set('ABC_020'),
    'sharp_14859': sharp_set('ABC_14859'),
    'sharp_168': sharp_set('ABC_168'),
    'sharp_275': sharp_set('ABC_275'),
    'nm_007': nm_set('007'),
    'nm_032': nm_set('032'),
    'nm_038': nm_set('038'),
    'nm_049': nm_set('049'),
    'qmdf_fertility': qmdf_set('organic/256', 'fertility'),
    'qmdf_teapot': qmdf_set('organic/256', 'teapot'),
    'qmdf_bunny': qmdf_set('organic/256', 'bunny'),
    'qmdf_abc020': qmdf_set('ABC/256', 'ABC_020'),
    'qmdf_abc003': qmdf_set('ABC/256', 'ABC_003'),
    'qmdf_abc093': qmdf_set('ABC/256', 'ABC_093'),
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


def cap_size(im, max_side=MAX_SIDE):
    """最长边压到 max_side 以内（只缩小不放大）。"""
    w, h = im.size
    s = min(1.0, max_side / max(w, h))
    if s == 1.0:
        return im
    return im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)


def crop_union(imgs, max_side=MAX_SIDE):
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
    s = min(1.0, max_side / max(cw, ch))
    print(f'    crop {cw}x{ch} -> scale {s:.4f}')
    if s < 1.0:
        out = {m: im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
               for m, im in out.items()}
    return out


def register_to_ref(imgs, max_side=MAX_SIDE):
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
    return {m: cap_size(im, max_side) for m, im in out.items()}


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
        max_side = spec.get('max_side', MAX_SIDE)
        quality = spec.get('quality', WEBP_QUALITY)
        if len(sizes) == 1:
            print(f'    sizes identical {next(iter(sizes))} -> identical-size crop path (max_side {max_side}, q {quality})')
            out = crop_union(imgs, max_side)
        else:
            print(f'    sizes differ {sorted(sizes)} -> registration path')
            out = register_to_ref(imgs, max_side)

        for m, im in out.items():
            fn = f'{name}_{m}.webp'
            im.save(OUT / fn, 'WEBP', quality=quality)
            written.add(fn)
            print(f'    wrote {fn} {im.size[0]}x{im.size[1]}')

    for f in sorted(OUT.iterdir()):
        if f.is_file() and f.name not in written:
            f.unlink()
            print('removed stale', f.name)


if __name__ == '__main__':
    main()
