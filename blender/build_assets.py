#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_assets.py —— 批量生成 32 件低面数 GLB 家具资产（Blender 4.x / 3.6）

用法（无需打开 Blender 界面）：
    blender -b -P blender/build_assets.py
    blender -b -P blender/build_assets.py -- --only bed_double,wardrobe   # 只做几件

输出：
    assets/glb/<name>.glb         32 个 GLB
    assets/glb/manifest.json      前端用来判断"是否已生成"的清单

约定（与 src/assets.js 的 ASSET_MANIFEST 一一对应）：
  · 单位米；Blender 是 Z-up，导出 GLB 时自动转 Y-up；
  · 模型原点在底面中心（x/y 居中、z 最低点为 0），所以前端 normalizeOrigin
    即使不校正也能正确落地；
  · 低面数：立方体 + 8~12 边圆柱，线脚只用 1 段倒角；
  · 颜色取前端的"浅橡木 + 暖白 + 灰绿"色板，sRGB→线性转换后写入 Principled。

跑完刷新页面，勾选顶栏「GLB 资产」即可用预制资产替换程序化家具
（顶部状态栏会显示"GLB 资产 N/32 件已替换"）。
"""

import bpy
import sys
import os
import json
import math

# --------------------------------------------------------------------------- #
# 32 件资产规格（必须与 src/assets.js 的 ASSET_MANIFEST 一致）
# size = (宽X, 高Z, 进深Y)，仅作为自检与清单记录
# --------------------------------------------------------------------------- #
ASSET_SPEC = {
    "bed_double":     {"cn": "双人床 1.5m",  "size": (1.50, 1.05, 2.00)},
    "bed_single":     {"cn": "单人床 1.2m",  "size": (1.20, 1.00, 1.95)},
    "crib":           {"cn": "婴儿床",        "size": (1.20, 0.92, 0.66)},
    "nightstand":     {"cn": "床头柜",        "size": (0.45, 0.50, 0.40)},
    "wardrobe":       {"cn": "衣柜",          "size": (2.00, 2.20, 0.60)},
    "desk":           {"cn": "升降书桌",      "size": (1.40, 0.75, 0.70)},
    "desk_chair":     {"cn": "人体工学椅",    "size": (0.68, 1.05, 0.68)},
    "bookshelf":      {"cn": "书架",          "size": (1.00, 1.80, 0.32)},
    "filing_cabinet": {"cn": "文件柜",        "size": (0.42, 0.62, 0.50)},
    "armchair":       {"cn": "单人沙发",      "size": (0.78, 0.76, 0.82)},
    "sofa_3seat":     {"cn": "三人沙发",      "size": (2.10, 0.78, 0.92)},
    "sofa_2seat":     {"cn": "双人沙发",      "size": (1.50, 0.78, 0.92)},
    "sofa_bed":       {"cn": "沙发床",        "size": (1.50, 0.78, 0.95)},
    "coffee_table":   {"cn": "茶几",          "size": (1.10, 0.40, 0.55)},
    "side_table":     {"cn": "边几",          "size": (0.45, 0.52, 0.45)},
    "tv_console":     {"cn": "电视柜",        "size": (1.80, 0.45, 0.42)},
    "dining_table":   {"cn": "餐桌 1.4m",     "size": (1.40, 0.75, 0.80)},
    "dining_chair":   {"cn": "餐椅",          "size": (0.46, 0.87, 0.50)},
    "sideboard":      {"cn": "餐边柜",        "size": (1.20, 0.80, 0.42)},
    "shoe_cabinet":   {"cn": "鞋柜",          "size": (1.20, 1.10, 0.35)},
    "bench":          {"cn": "换鞋凳",        "size": (0.90, 0.42, 0.38)},
    "coat_rack":      {"cn": "衣帽架",        "size": (0.35, 1.77, 0.35)},
    "kitchen_counter": {"cn": "橱柜地柜",     "size": (1.30, 0.86, 0.60)},
    "sink":           {"cn": "水槽 + 龙头",   "size": (0.62, 0.28, 0.44)},
    "stove":          {"cn": "燃气灶",        "size": (0.60, 0.06, 0.50)},
    "range_hood":     {"cn": "油烟机",        "size": (0.60, 0.62, 0.52)},
    "fridge":         {"cn": "冰箱",          "size": (0.60, 1.85, 0.65)},
    "toilet":         {"cn": "马桶",          "size": (0.68, 0.80, 0.70)},
    "vanity":         {"cn": "浴室柜",        "size": (0.80, 0.85, 0.45)},
    "shower":         {"cn": "淋浴房",        "size": (0.90, 2.00, 0.90)},
    "washer":         {"cn": "洗衣机",        "size": (0.60, 0.86, 0.62)},
    "plant":          {"cn": "绿植",          "size": (0.32, 1.00, 0.32)},
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "glb")


# --------------------------------------------------------------------------- #
# 色板（与 src/materials.js PALETTE 对齐）+ sRGB→线性
# --------------------------------------------------------------------------- #
def srgb(hexv):
    """sRGB hex → Blender 线性 RGBA"""
    def c(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((hexv >> 16) & 255), c((hexv >> 8) & 255), c(hexv & 255), 1.0)


PAL = {
    "oak":       0xC9A87C,   # 浅橡木
    "oak_light": 0xD8C3A2,
    "oak_dark":  0xA5814F,
    "wall":      0xF2EDE4,   # 暖白
    "green":     0x7C8A76,   # 灰绿（布艺）
    "green_dp":  0x5C6957,
    "cream":     0xECE5D6,
    "linen":     0xD9D2C3,
    "dark":      0x3A3936,
    "metal":     0x4C4C4A,
    "steel":     0xB8B8B4,
    "white":     0xF4F2ED,   # 陶瓷
    "stone":     0xCFC9BE,
    "terrazzo":  0xDEDAD1,
    "lamp":      0xFFD9A8,   # 灯罩暖光
}


def mat(name, color, rough=0.6, metal=0.0, emit=None, emit_strength=0.0,
        alpha=1.0, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        return m
    bsdf.inputs["Base Color"].default_value = srgb(color) if isinstance(color, int) else color
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    # 4.x / 3.x 的 emission 插槽名不同，逐个尝试
    if emit is not None:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = srgb(emit) if isinstance(emit, int) else emit
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emit_strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND"
    if transmission > 0 and "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = transmission
    return m


MAT = {}


def build_materials():
    MAT["oak"] = mat("oak", PAL["oak"], 0.55)
    MAT["oak_light"] = mat("oak_light", PAL["oak_light"], 0.5)
    MAT["oak_dark"] = mat("oak_dark", PAL["oak_dark"], 0.52)
    MAT["wood_top"] = mat("wood_top", PAL["oak"], 0.42)
    MAT["cloth"] = mat("cloth", PAL["green"], 0.94)
    MAT["cloth2"] = mat("cloth2", PAL["cream"], 0.95)
    MAT["linen"] = mat("linen", PAL["linen"], 0.92)
    MAT["metal"] = mat("metal", PAL["metal"], 0.42, 0.75)
    MAT["steel"] = mat("steel", PAL["steel"], 0.3, 0.85)
    MAT["white"] = mat("ceramic", PAL["white"], 0.14)
    MAT["dark"] = mat("dark", PAL["dark"], 0.6, 0.1)
    MAT["stone"] = mat("stone", PAL["stone"], 0.4)
    MAT["terrazzo"] = mat("terrazzo", PAL["terrazzo"], 0.5)
    MAT["glass"] = mat("glass", 0xE4EFEC, 0.06, 0.0, alpha=0.22, transmission=0.9)
    MAT["screen"] = mat("screen", 0x14161A, 0.16, 0.35)
    MAT["lamp"] = mat("lamp_shade", PAL["lamp"], 0.85, emit=PAL["lamp"], emit_strength=1.2)
    MAT["leaf"] = mat("leaf", 0x7FA06D, 0.62)
    MAT["home"] = mat("home_appliance", PAL["white"], 0.4, 0.05)


# --------------------------------------------------------------------------- #
# 基础几何工具（Z-up：x=宽，y=进深，z=高；z 传"中心高度"）
# --------------------------------------------------------------------------- #
def _finish(obj, material, bevel=0.0):
    if material:
        obj.data.materials.append(material)
    if bevel > 0:
        b = obj.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 1
        b.limit_method = "ANGLE"
    return obj


def box(sx, sy, sz, x=0.0, y=0.0, z=0.0, material=None, bevel=0.0, rot_z=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    if rot_z:
        o.rotation_euler[2] = math.radians(rot_z)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return _finish(o, material, bevel)


def cyl(r, h, x=0.0, y=0.0, z=0.0, material=None, verts=12, r2=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=r, depth=h, location=(x, y, z))
    o = bpy.context.active_object
    if r2 is not None and abs(r2 - r) > 1e-6:
        # 锥形：手动缩放顶面顶点
        for v in o.data.vertices:
            if v.co.z > 0:
                v.co.x *= r2 / r
                v.co.y *= r2 / r
    if any(rot):
        o.rotation_euler = (math.radians(rot[0]), math.radians(rot[1]), math.radians(rot[2]))
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return _finish(o, material)


def sphere(r, x=0.0, y=0.0, z=0.0, material=None, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=r,
                                         location=(x, y, z))
    o = bpy.context.active_object
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, material)


def slab(sx, sy, sz, x=0.0, y=0.0, z=0.0, material=None, bevel=0.022):
    """软包/床垫那种圆角板：用一段倒角近似"""
    return box(sx, sy, sz, x, y, z, material, bevel=bevel)


def legs(sx, sy, h, x=0.0, y=0.0, r=0.022, material=None, taper=0.7):
    """四腿（h 为腿高，底面 z=0）"""
    for ix in (-1, 1):
        for iy in (-1, 1):
            cyl(r, h, x + ix * sx, y + iy * sy, h / 2, material, verts=8, r2=r * taper)


def frame_rect(sx, sy, sz, t, x=0.0, y=0.0, z=0.0, material=None):
    """矩形框（门套/窗框那种），t 为料宽"""
    box(sx, t, sz, x, y - sy / 2 + t / 2, z, material)
    box(sx, t, sz, x, y + sy / 2 - t / 2, z, material)
    box(t, sy - t * 2, sz, x - sx / 2 + t / 2, y, z, material)
    box(t, sy - t * 2, sz, x + sx / 2 - t / 2, y, z, material)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0


# --------------------------------------------------------------------------- #
# 32 件资产
# --------------------------------------------------------------------------- #
def a_bed_double(w=1.50, l=2.00):
    box(w, l, 0.24, 0, 0, 0.22, MAT["oak_dark"])           # 床架
    legs(w / 2 - 0.10, l / 2 - 0.10, 0.10, 0, 0, 0.024, MAT["oak_dark"])
    slab(w - 0.04, l - 0.04, 0.20, 0, 0, 0.44, MAT["cloth2"])   # 床垫
    slab(w - 0.02, l - 0.50, 0.10, 0, 0.24, 0.59, MAT["cloth"])  # 被子（灰绿）
    slab(w - 0.16, 0.42, 0.14, -0.33, -l / 2 + 0.32, 0.61, MAT["cloth2"])  # 枕头
    slab(w - 0.16, 0.42, 0.14, 0.33, -l / 2 + 0.32, 0.61, MAT["cloth2"])
    box(w, 0.07, 1.00, 0, -l / 2 - 0.02, 0.60, MAT["oak"])       # 床头板


def a_bed_single(w=1.20, l=1.95):
    box(w, l, 0.22, 0, 0, 0.20, MAT["oak_dark"])
    legs(w / 2 - 0.09, l / 2 - 0.09, 0.09, 0, 0, 0.022, MAT["oak_dark"])
    slab(w - 0.04, l - 0.04, 0.18, 0, 0, 0.40, MAT["cloth2"])
    slab(w - 0.02, l - 0.45, 0.09, 0, 0.21, 0.53, MAT["linen"])
    slab(w - 0.40, 0.40, 0.13, 0, -l / 2 + 0.30, 0.55, MAT["cloth2"])
    box(w, 0.06, 0.90, 0, -l / 2 - 0.02, 0.55, MAT["oak"])


def a_crib(w=1.20, d=0.66):
    h = 0.72
    for ix in (-1, 1):
        for iy in (-1, 1):
            box(0.05, 0.05, h, ix * (w / 2 - 0.03), iy * (d / 2 - 0.03), h / 2, MAT["oak"])
    n = int(w / 0.10)
    for i in range(n + 1):
        x = -w / 2 + 0.05 + i * (w - 0.10) / n
        box(0.022, 0.022, h - 0.10, x, -d / 2 + 0.03, h / 2 + 0.05, MAT["oak"])
        box(0.022, 0.022, h - 0.10, x, d / 2 - 0.03, h / 2 + 0.05, MAT["oak"])
    nd = max(3, int(d / 0.12))
    for i in range(nd + 1):
        y = -d / 2 + 0.05 + i * (d - 0.10) / nd
        box(0.022, 0.022, h - 0.10, w / 2 - 0.03, y, h / 2 + 0.05, MAT["oak"])
        box(0.022, 0.022, h - 0.10, -w / 2 + 0.03, y, h / 2 + 0.05, MAT["oak"])
    for s in (-1, 1):
        box(w, 0.05, 0.03, 0, s * (d / 2 - 0.03), h, MAT["oak"])
        box(0.05, d, 0.03, s * (w / 2 - 0.03), 0, h, MAT["oak"])
    box(w - 0.10, d - 0.10, 0.06, 0, 0, 0.28, MAT["oak_dark"])
    slab(w - 0.14, d - 0.14, 0.12, 0, 0, 0.37, MAT["cloth2"])


def a_nightstand(w=0.45, d=0.40, h=0.50):
    box(w, d, h - 0.16, 0, 0, 0.08 + (h - 0.16) / 2, MAT["oak"])
    box(w + 0.02, d + 0.02, 0.025, 0, 0, h - 0.012, MAT["wood_top"])
    box(w - 0.06, 0.008, 0.012, 0, d / 2 + 0.003, h - 0.30, MAT["oak_dark"])
    cyl(0.012, 0.02, w / 2 - 0.07, d / 2 + 0.012, h - 0.30, MAT["metal"], verts=8)
    legs(w / 2 - 0.045, d / 2 - 0.045, 0.08, 0, 0, 0.016, MAT["oak_dark"])


def a_wardrobe(w=2.00, d=0.60, h=2.20):
    box(w, d - 0.04, h - 0.14, 0, -0.02, 0.07 + (h - 0.14) / 2, MAT["oak"])
    box(w - 0.06, d - 0.02, 0.07, 0, 0, 0.035, MAT["oak_dark"])
    doors = 3 if w > 1.6 else 2
    dw = (w - 0.04) / doors
    for i in range(doors):
        x = -w / 2 + 0.02 + dw * (i + 0.5)
        box(dw - 0.012, 0.02, h - 0.22, x, d / 2 - 0.03, 0.11 + (h - 0.22) / 2, MAT["wood_top"])
        hx = x + (dw / 2 - 0.05 if i < doors - 1 else -dw / 2 + 0.05)
        box(0.016, 0.016, 0.42, hx, d / 2 - 0.008, 1.02, MAT["metal"])
    box(w + 0.01, d, 0.03, 0, 0, h - 0.015, MAT["wood_top"])


def a_desk(w=1.40, d=0.70, h=0.75):
    box(w, d, 0.045, 0, 0, h - 0.022, MAT["wood_top"])
    for s in (-1, 1):
        box(0.09, 0.09, h - 0.12, s * (w / 2 - 0.12), 0, (h - 0.12) / 2 + 0.06, MAT["steel"])
        box(0.50, 0.28, 0.02, s * (w / 2 - 0.36), 0, 0.06, MAT["steel"])
    box(w - 0.30, 0.07, 0.06, 0, -d / 2 + 0.12, h - 0.09, MAT["steel"])
    box(0.08, 0.05, 0.03, w / 2 - 0.12, d / 2 - 0.10, h - 0.06, MAT["dark"])


def a_desk_chair(w=0.62, d=0.62):
    seat_h = 0.46
    for i in range(5):
        ang = i / 5 * math.tau
        box(0.05, 0.26, 0.025, math.sin(ang) * 0.16, math.cos(ang) * 0.16, 0.035,
            MAT["dark"], rot_z=-math.degrees(ang))
        cyl(0.022, 0.03, math.sin(ang) * 0.28, math.cos(ang) * 0.28, 0.015, MAT["dark"], verts=8)
    cyl(0.028, seat_h - 0.06, 0, 0, (seat_h - 0.06) / 2 + 0.05, MAT["steel"], verts=10)
    slab(w, d - 0.06, 0.09, 0, 0, seat_h, MAT["cloth"])
    back = slab(w - 0.06, 0.09, 0.62, 0, -d / 2 + 0.04, seat_h + 0.34, MAT["cloth"])
    back.rotation_euler[0] = math.radians(-7)
    box(0.04, 0.04, 0.30, 0, -d / 2 + 0.08, seat_h + 0.15, MAT["dark"])
    for s in (-1, 1):
        box(0.035, 0.035, 0.18, s * (w / 2 - 0.02), -0.02, seat_h + 0.06, MAT["dark"])
        box(0.04, 0.22, 0.03, s * (w / 2 - 0.02), 0.06, seat_h + 0.15, MAT["dark"])


def a_bookshelf(w=1.00, d=0.32, h=1.80):
    for s in (-1, 1):
        box(0.025, d, h, s * (w / 2 - 0.012), 0, h / 2, MAT["oak"])
    box(w - 0.05, d, 0.02, 0, 0, h - 0.01, MAT["oak"])
    box(w - 0.05, d, 0.02, 0, 0, 0.012, MAT["oak"])
    book_cols = [0xB9AD96, 0x8F9A8C, 0xA8634F, 0x6D7385, 0xD8C9AC]
    for i in range(1, 5):
        z = h / 5 * i
        box(w - 0.05, d - 0.02, 0.02, 0, 0, z, MAT["oak"])
        x = -w / 2 + 0.05
        k = i
        while x < w / 2 - 0.09:
            bw = 0.03 + (k % 4) * 0.012
            bh = 0.20 + (k % 3) * 0.035
            bm = bpy.data.materials.get("book_%d" % (k % 5))
            if bm is None:
                bm = mat("book_%d" % (k % 5), book_cols[k % 5], 0.85)
            box(bw, d - 0.09, bh, x + bw / 2, 0, z + 0.01 + bh / 2, bm)
            x += bw + 0.006
            k += 1


def a_filing_cabinet(w=0.42, d=0.50, h=0.62):
    box(w, d, h - 0.10, 0, 0, 0.05 + (h - 0.10) / 2, MAT["oak"])
    box(w + 0.015, d + 0.015, 0.025, 0, 0, h - 0.012, MAT["wood_top"])
    for i in range(2):
        z = 0.14 + i * ((h - 0.16) / 2 + 0.005)
        box(w - 0.05, 0.02, (h - 0.16) / 2 - 0.012, 0, d / 2 - 0.02, z, MAT["wood_top"])
        box(w - 0.20, 0.014, 0.014, 0, d / 2 - 0.006, z, MAT["metal"])
    legs(w / 2 - 0.04, d / 2 - 0.04, 0.05, 0, 0, 0.012, MAT["metal"])


def _sofa(w, d, h, seats, bed=False):
    box(w - 0.06, d - 0.08, 0.10, 0, 0, 0.14, MAT["oak_dark"])
    slab(w - 0.02, d - 0.04, 0.22, 0, 0.02, 0.32, MAT["cloth"])       # 底座=灰绿
    cw = (w - 0.30) / seats
    for i in range(seats):
        x = -w / 2 + 0.15 + cw * (i + 0.5)
        slab(cw - 0.03, d - 0.24, 0.13, x, 0.07, 0.47, MAT["cloth2"])  # 坐垫=暖白
        slab(cw - 0.03, 0.14, 0.36, x, -d / 2 + 0.15, 0.60, MAT["cloth2"])
    slab(w * 0.30, d * 0.50, 0.12, -w * 0.24, 0.06, 0.56, MAT["linen"])  # 抱枕
    if bed:
        for s in (-1, 1):
            box(0.08, d - 0.14, 0.20, s * (w / 2 - 0.05), 0, 0.08, MAT["oak_dark"])
        box(w - 0.10, 0.014, 0.014, 0, d / 2 - 0.08, 0.20, MAT["metal"])
    else:
        for s in (-1, 1):
            box(0.14, d - 0.06, 0.30, s * (w / 2 - 0.07), 0, 0.44, MAT["cloth"], bevel=0.03)
            box(0.06, d - 0.14, 0.10, s * (w / 2 - 0.07), 0, 0.08, MAT["oak_dark"])
    legs(w / 2 - 0.10, d / 2 - 0.10, 0.10, 0, 0, 0.022, MAT["oak_dark"])


def a_sofa_3seat(w=2.10, d=0.92, h=0.78):
    _sofa(w, d, h, 3)


def a_sofa_2seat(w=1.50, d=0.92, h=0.78):
    _sofa(w, d, h, 2)


def a_sofa_bed(w=1.50, d=0.95, h=0.78):
    _sofa(w, d, h, 1, bed=True)


def a_armchair(w=0.78, d=0.82, h=0.76):
    slab(w, d, 0.20, 0, 0, 0.33, MAT["cloth"])
    back = slab(w, 0.16, h - 0.24, 0, -d / 2 + 0.09, h - (h - 0.24) / 2 - 0.06, MAT["cloth"])
    back.rotation_euler[0] = math.radians(8)
    for s in (-1, 1):
        slab(0.13, d - 0.10, 0.22, s * (w / 2 - 0.065), 0.02, 0.44, MAT["cloth"])
    slab(w - 0.20, d - 0.22, 0.11, 0, 0.05, 0.47, MAT["cloth2"])
    slab(w - 0.28, 0.12, 0.34, 0, -d / 2 + 0.22, 0.62, MAT["cloth2"])
    legs(w / 2 - 0.08, d / 2 - 0.08, 0.16, 0, 0, 0.024, MAT["oak_dark"])


def a_coffee_table(w=1.10, d=0.55, h=0.40):
    box(w, d, 0.03, 0, 0, h - 0.015, MAT["wood_top"])
    box(w - 0.12, d - 0.12, 0.02, 0, 0, 0.14, MAT["oak"])
    legs(w / 2 - 0.05, d / 2 - 0.05, h - 0.03, 0, 0, 0.02, MAT["oak_dark"])
    cyl(0.05, 0.09, w * 0.22, 0, h + 0.045, MAT["white"], verts=10, r2=0.06)
    box(0.20, 0.15, 0.02, -w * 0.20, 0.02, h + 0.02, MAT["linen"])


def a_side_table(w=0.45, h=0.52):
    cyl(w / 2, 0.03, 0, 0, h - 0.015, MAT["stone"], verts=16, r2=w / 2)
    for i in range(3):
        ang = i / 3 * math.tau + 0.4
        cyl(0.014, h - 0.03, math.sin(ang) * (w / 2 - 0.05),
            math.cos(ang) * (w / 2 - 0.05), (h - 0.03) / 2, MAT["metal"], verts=8, r2=0.017)
    cyl(0.04, 0.16, 0, 0, h + 0.08, MAT["white"], verts=10, r2=0.05)


def a_tv_console(w=1.80, d=0.42, h=0.45):
    box(w, d, h - 0.16, 0, 0, 0.08 + (h - 0.16) / 2, MAT["oak"])
    box(w + 0.02, d + 0.02, 0.03, 0, 0, h - 0.015, MAT["wood_top"])
    n = 3 if w > 1.5 else 2
    dw = (w - 0.06) / n
    for i in range(n):
        x = -w / 2 + 0.03 + dw * (i + 0.5)
        box(dw - 0.01, 0.018, h - 0.22, x, d / 2 - 0.03, 0.11 + (h - 0.22) / 2, MAT["wood_top"])
        box(0.012, 0.012, dw * 0.35, x, d / 2 - 0.006, h - 0.12, MAT["metal"])
    box(w - 0.10, d - 0.06, 0.12, 0, 0, 0.06, MAT["oak_dark"])
    legs(w / 2 - 0.06, d / 2 - 0.06, 0.06, 0, 0, 0.014, MAT["metal"])
    cyl(0.055, 0.12, w * 0.30, 0, h + 0.075, MAT["white"], verts=10, r2=0.065)
    box(0.16, 0.11, 0.09, -w * 0.28, 0, h + 0.06, MAT["dark"])


def a_dining_table(w=1.40, d=0.80, h=0.75):
    box(w, d, 0.04, 0, 0, h - 0.02, MAT["wood_top"])
    box(w - 0.30, d - 0.30, 0.05, 0, 0, h - 0.07, MAT["oak"])
    legs(w / 2 - 0.09, d / 2 - 0.09, h - 0.04, 0, 0, 0.028, MAT["oak_dark"], taper=0.5)
    box(w - 0.24, 0.025, 0.025, 0, 0, 0.22, MAT["oak"])


def a_dining_chair(w=0.46, d=0.50):
    sh, bh = 0.45, 0.42
    box(w, d, 0.035, 0, 0, sh - 0.018, MAT["wood_top"])
    legs(w / 2 - 0.035, d / 2 - 0.04, sh - 0.035, 0, 0, 0.019, MAT["oak"])
    for s in (-1, 1):
        box(0.025, 0.025, bh, s * (w / 2 - 0.035), -d / 2 + 0.035, sh + bh / 2 - 0.02, MAT["oak"])
    box(w - 0.05, 0.022, 0.06, 0, -d / 2 + 0.035, sh + bh - 0.02, MAT["oak"])
    box(w - 0.09, 0.02, 0.03, 0, -d / 2 + 0.035, sh + bh * 0.5, MAT["oak"])


def a_sideboard(w=1.20, d=0.42, h=0.80):
    box(w, d, h - 0.20, 0, 0, 0.12 + (h - 0.20) / 2, MAT["oak"])
    box(w + 0.02, d + 0.02, 0.03, 0, 0, h - 0.015, MAT["wood_top"])
    for s in (-1, 1):
        box(w / 2 - 0.03, 0.02, h - 0.26, s * w / 4, d / 2 - 0.025, 0.12 + (h - 0.20) / 2, MAT["wood_top"])
    box(w * 0.22, 0.014, 0.014, -0.12, d / 2 - 0.004, h - 0.24, MAT["metal"])
    box(w * 0.22, 0.014, 0.014, 0.12, d / 2 - 0.004, h - 0.24, MAT["metal"])
    legs(w / 2 - 0.06, d / 2 - 0.06, 0.12, 0, 0, 0.02, MAT["oak_dark"])
    cyl(0.05, 0.22, -w * 0.30, 0, h + 0.10, MAT["white"], verts=10, r2=0.07)
    box(0.14, 0.06, 0.20, w * 0.30, 0, h + 0.11, MAT["linen"])


def a_shoe_cabinet(w=1.20, d=0.35, h=1.10):
    box(w, d, h - 0.16, 0, 0, 0.08 + (h - 0.16) / 2, MAT["oak"])
    box(w + 0.015, d + 0.015, 0.03, 0, 0, h - 0.015, MAT["wood_top"])
    for i in range(3):
        z = 0.14 + i * ((h - 0.28) / 3)
        for s in (-1, 1):
            box((w - 0.05) / 2 - 0.012, 0.018, (h - 0.28) / 3 - 0.012,
                s * w / 4, d / 2 - 0.02, z + (h - 0.28) / 6, MAT["wood_top"])
        box(0.012, 0.012, 0.10, -0.03, d / 2 - 0.008, z + (h - 0.28) / 6, MAT["metal"])
        box(0.012, 0.012, 0.10, 0.03, d / 2 - 0.008, z + (h - 0.28) / 6, MAT["metal"])
    box(w - 0.08, d - 0.02, 0.07, 0, 0, 0.035, MAT["oak_dark"])
    cyl(0.05, 0.14, -w * 0.30, 0, h + 0.08, MAT["white"], verts=10, r2=0.06)


def a_bench(w=0.90, d=0.38, h=0.42):
    slab(w, d, 0.10, 0, 0, h - 0.05, MAT["linen"])
    box(w - 0.03, d - 0.03, 0.03, 0, 0, h - 0.115, MAT["oak"])
    for s in (-1, 1):
        box(0.03, d - 0.04, h - 0.13, s * (w / 2 - 0.03), 0, (h - 0.13) / 2, MAT["oak"])
        box(0.03, d - 0.06, 0.025, s * (w / 2 - 0.03), 0, 0.30, MAT["oak"])


def a_coat_rack(h=1.72):
    cyl(0.11, 0.025, 0, 0, 0.012, MAT["oak"], verts=16, r2=0.12)
    cyl(0.021, h - 0.02, 0, 0, h / 2, MAT["metal"], verts=10, r2=0.024)
    for i in range(6):
        ang = i / 6 * math.tau
        box(0.026, 0.026, 0.16, math.sin(ang) * 0.08, math.cos(ang) * 0.08, h - 0.16,
            MAT["oak"], rot_z=math.degrees(ang))
        cyl(0.016, 0.02, math.sin(ang) * 0.16, math.cos(ang) * 0.16, h - 0.06, MAT["oak"], verts=8)
    cyl(0.09, 0.02, 0, 0, h + 0.01, MAT["oak"], verts=14, r2=0.09)
    box(0.26, 0.26, 0.03, 0, 0, h + 0.035, MAT["wood_top"], bevel=0.01)


def a_kitchen_counter(w=1.30, d=0.60, H=0.86):
    box(w, d - 0.05, H - 0.14, 0, -0.025, 0.10 + (H - 0.14) / 2, MAT["oak"])
    box(w - 0.06, d - 0.16, 0.10, 0, -0.05, 0.05, MAT["dark"])
    box(w + 0.01, d + 0.01, 0.04, 0, 0, H - 0.02, MAT["terrazzo"], bevel=0.008)
    box(w, 0.02, 0.025, 0, d / 2 - 0.06, H - 0.05, MAT["oak_dark"])
    n = max(1, int(w / 0.6))
    dw = (w - 0.02) / n
    for i in range(n):
        x = -w / 2 + 0.01 + dw * (i + 0.5)
        box(dw - 0.01, 0.018, H - 0.26, x, d / 2 - 0.035, 0.16 + (H - 0.26) / 2, MAT["wood_top"])
        box(dw * 0.4, 0.012, 0.012, x, d / 2 - 0.02, H - 0.20, MAT["metal"])


def a_sink(w=0.62, d=0.44):
    box(w, d, 0.012, 0, 0, 0.002, MAT["steel"])
    box(w - 0.05, d - 0.05, 0.13, 0, 0, -0.045, MAT["dark"])
    box(w - 0.06, d - 0.06, 0.008, 0, 0, -0.108, MAT["steel"])
    cyl(0.018, 0.26, w / 2 - 0.07, -d / 2 + 0.05, 0.13, MAT["steel"], verts=10, r2=0.018)
    cyl(0.014, 0.20, w / 2 - 0.14, -d / 2 + 0.05, 0.25, MAT["steel"], verts=10,
        r2=0.014, rot=(0, 90, 0))
    cyl(0.012, 0.04, w / 2 - 0.22, -d / 2 + 0.05, 0.23, MAT["steel"], verts=8)


def a_stove(w=0.60, d=0.50):
    box(w, d, 0.02, 0, 0, 0.012, MAT["screen"])
    box(w - 0.01, d - 0.01, 0.006, 0, 0, 0.025, MAT["steel"])
    for s in (-1, 1):
        cyl(0.075, 0.012, s * w * 0.22, 0, 0.035, MAT["dark"], verts=14, r2=0.075)
        cyl(0.050, 0.020, s * w * 0.22, 0, 0.045, MAT["steel"], verts=12, r2=0.050)
        cyl(0.022, 0.020, s * w * 0.22, 0, 0.045, MAT["steel"], verts=10, r2=0.028)
    for i in range(2):
        cyl(0.018, 0.02, -0.10 + i * 0.20, d / 2 - 0.03, 0.035, MAT["metal"], verts=10)


def a_range_hood(w=0.60, d=0.52, h=0.62):
    box(w, d, 0.08, 0, 0, -h / 2 + 0.04, MAT["steel"])
    box(w * 0.42, d * 0.50, h - 0.20, 0, -d * 0.18, h / 2 - 0.10, MAT["steel"])
    box(w - 0.06, d - 0.10, 0.02, 0, 0, -h / 2 + 0.09, MAT["dark"])
    for s in (-1, 1):
        cyl(0.012, 0.03, s * 0.16, -d / 2 + 0.06, -h / 2 + 0.105, MAT["metal"], verts=8)
    box(w * 0.50, 0.02, 0.008, 0, d * 0.12, -h / 2 + 0.086, MAT["lamp"])


def a_fridge(w=0.60, d=0.65, h=1.85):
    box(w, d, h, 0, 0, h / 2, MAT["steel"])
    box(w - 0.02, d - 0.02, h * 0.62, 0, 0.012, h * 0.31 + 0.02, MAT["home"])
    box(w - 0.02, d - 0.02, h * 0.34, 0, 0.012, h * 0.83, MAT["home"])
    box(w, d - 0.01, 0.012, 0, 0.02, h * 0.65, MAT["dark"])
    box(0.02, 0.02, h * 0.34, -0.20, d / 2 + 0.02, h * 0.83, MAT["metal"])
    box(0.02, 0.02, h * 0.17, 0.20, d / 2 + 0.02, h * 0.20, MAT["metal"])


def a_toilet(w=0.68, d=0.70):
    box(w, d * 0.42, 0.42, 0, -d / 2 + d * 0.22, 0.21, MAT["white"])
    o = cyl(w * 0.46, 0.36, 0, d * 0.10, 0.20, MAT["white"], verts=14, r2=w * 0.30)
    o.scale.y = 1.24
    slab(w * 0.98, d * 0.68, 0.06, 0, d * 0.08, 0.42, MAT["white"])
    cyl(w * 0.40, 0.036, 0, d * 0.08, 0.44, MAT["white"], verts=16, r2=w * 0.40)
    box(w * 0.90, 0.17, 0.50, 0, -d / 2 + 0.085, 0.53, MAT["white"])
    box(w * 0.92, 0.19, 0.03, 0, -d / 2 + 0.09, 0.79, MAT["white"])
    box(0.10, 0.03, 0.012, 0, -d / 2 + 0.185, 0.79, MAT["steel"])


def a_vanity(w=0.80, d=0.45, h=0.85):
    box(w, d, h - 0.20, 0, 0, 0.12 + (h - 0.20) / 2, MAT["oak"])
    box(w + 0.02, d + 0.02, 0.04, 0, 0, h - 0.02, MAT["stone"], bevel=0.008)
    cyl(w * 0.32, 0.16, 0, 0.02, h + 0.06, MAT["white"], verts=14, r2=w * 0.26)
    cyl(w * 0.33, 0.024, 0, 0.02, h + 0.14, MAT["white"], verts=16, r2=w * 0.33)
    cyl(0.015, 0.20, 0, -d / 2 + 0.09, h + 0.14, MAT["steel"], verts=10, r2=0.015)
    cyl(0.012, 0.13, 0, -d / 2 + 0.155, h + 0.24, MAT["steel"], verts=10,
        r2=0.012, rot=(90, 0, 0))
    for s in (-1, 1):
        box(w / 2 - 0.03, 0.018, h - 0.30, s * w / 4, d / 2 - 0.025, 0.15 + (h - 0.30) / 2, MAT["wood_top"])
        box(0.012, 0.012, 0.10, s * 0.04, d / 2 - 0.008, h - 0.22, MAT["metal"])


def a_shower(w=0.90, d=0.90, h=2.00):
    slab(w, d, 0.06, 0, 0, 0.03, MAT["white"])
    cyl(0.04, 0.05, 0, 0, 0.075, MAT["steel"], verts=10)
    box(0.012, d - 0.02, h - 0.12, -w / 2 + 0.006, 0, (h - 0.12) / 2 + 0.06, MAT["glass"])
    box(w - 0.02, 0.012, h - 0.12, 0, d / 2 - 0.006, (h - 0.12) / 2 + 0.06, MAT["glass"])
    for (x, y) in ((-w / 2 + 0.011, -d / 2 + 0.011), (-w / 2 + 0.011, d / 2 - 0.011),
                   (w / 2 - 0.011, d / 2 - 0.011)):
        box(0.022, 0.022, h, x, y, h / 2, MAT["steel"])
    box(w - 0.05, 0.012, h - 0.40, -w / 2 + 0.14, d / 2 - 0.02, (h - 0.40) / 2 + 0.10, MAT["glass"])
    cyl(0.014, 0.36, -w / 2 + 0.24, d / 2 + 0.025, h - 0.50, MAT["steel"], verts=8)
    cyl(0.016, 0.50, w / 2 - 0.24, -d / 2 + 0.06, h - 0.55, MAT["steel"], verts=10, r2=0.016)
    cyl(0.09, 0.03, w / 2 - 0.24, -d / 2 + 0.10, h - 0.28, MAT["steel"], verts=14, r2=0.07)


def a_washer(w=0.60, d=0.62, h=0.86):
    box(w, d, h, 0, 0, h / 2, MAT["home"])
    box(w, d, 0.05, 0, 0, h - 0.025, MAT["metal"])
    cyl(0.21, 0.03, 0, d / 2 + 0.008, h * 0.46, MAT["dark"], verts=16, r2=0.21, rot=(90, 0, 0))
    cyl(0.185, 0.01, 0, d / 2 + 0.02, h * 0.46, MAT["steel"], verts=16, r2=0.185, rot=(90, 0, 0))
    cyl(0.175, 0.012, 0, d / 2 + 0.026, h * 0.46, MAT["glass"], verts=16, r2=0.175, rot=(90, 0, 0))
    box(w - 0.06, 0.01, 0.09, 0, d / 2 + 0.002, h - 0.09, MAT["dark"])
    for i in range(3):
        cyl(0.014, 0.014, w / 2 - 0.07 - i * 0.05, d / 2 + 0.012, h - 0.09, MAT["white"], verts=8)
    box(0.30, 0.005, 0.03, 0, d / 2 + 0.004, h - 0.06, MAT["steel"])


def a_plant(h=1.00):
    pot_r = min(0.24, 0.10 + h * 0.10)
    cyl(pot_r, pot_r * 1.5, 0, 0, pot_r * 0.75, MAT["white"], verts=14, r2=pot_r * 0.78)
    cyl(pot_r * 0.9, 0.02, 0, 0, pot_r * 1.45, MAT["dark"], verts=12, r2=pot_r * 0.9)
    trunk = h - pot_r * 1.5
    if trunk > 0.2:
        cyl(0.012, trunk * 0.7, 0, 0, pot_r * 1.5 + trunk * 0.35, MAT["oak_dark"],
            verts=6, r2=0.018)
    clusters = 5 if h < 0.7 else 7
    for i in range(clusters):
        ang = i / clusters * math.tau + i * 0.7
        rr = (0.10 if h < 0.7 else 0.16) * (0.5 + (i % 3) * 0.25)
        z = pot_r * 1.5 + trunk * (0.45 + (i % 4) * 0.14)
        for k in range(4):
            a2 = ang + k * 0.7
            sphere(0.5, math.sin(a2) * rr, math.cos(a2) * rr, z - k * 0.02, MAT["leaf"],
                   scale=(0.028, 0.20, 0.055))


BUILDERS = {
    "bed_double": a_bed_double, "bed_single": a_bed_single, "crib": a_crib,
    "nightstand": a_nightstand, "wardrobe": a_wardrobe, "desk": a_desk,
    "desk_chair": a_desk_chair, "bookshelf": a_bookshelf,
    "filing_cabinet": a_filing_cabinet, "armchair": a_armchair,
    "sofa_3seat": a_sofa_3seat, "sofa_2seat": a_sofa_2seat, "sofa_bed": a_sofa_bed,
    "coffee_table": a_coffee_table, "side_table": a_side_table,
    "tv_console": a_tv_console, "dining_table": a_dining_table,
    "dining_chair": a_dining_chair, "sideboard": a_sideboard,
    "shoe_cabinet": a_shoe_cabinet, "bench": a_bench, "coat_rack": a_coat_rack,
    "kitchen_counter": a_kitchen_counter, "sink": a_sink, "stove": a_stove,
    "range_hood": a_range_hood, "fridge": a_fridge, "toilet": a_toilet,
    "vanity": a_vanity, "shower": a_shower, "washer": a_washer, "plant": a_plant,
}


# --------------------------------------------------------------------------- #
# 导出
# --------------------------------------------------------------------------- #
def export_glb(name, path):
    for o in bpy.context.scene.objects:
        o.select_set(True)
    # 尽量少传参数，避免不同 Blender 版本的 kwarg 差异
    try:
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB",
            export_apply=True, export_yup=True, export_materials="EXPORT")
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")
    return os.path.getsize(path)


def write_manifest(names):
    mf = {
        "present": True,
        "generated": names,
        "count": len(names),
        "generator": "blender/build_assets.py",
        "note": "由 Blender 脚本生成的 32 件低面数 GLB 资产。前端勾选「GLB 资产」后会替换同名程序化家具。",
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(mf, f, ensure_ascii=False, indent=2)


def main():
    argv = sys.argv
    only = None
    if "--" in argv:
        extra = argv[argv.index("--") + 1:]
        for i, a in enumerate(extra):
            if a == "--only" and i + 1 < len(extra):
                only = [s.strip() for s in extra[i + 1].split(",") if s.strip()]

    os.makedirs(OUT, exist_ok=True)
    names = [n for n in ASSET_SPEC if (only is None or n in only)]
    print("=" * 62)
    print("生成 %d 件 GLB -> %s" % (len(names), OUT))
    print("=" * 62)

    done, failed, total_bytes = [], [], 0
    for i, name in enumerate(names, 1):
        fn = BUILDERS.get(name)
        if fn is None:
            print("  [%2d/%d] %-16s 跳过（脚本里没有对应 build 函数）" % (i, len(names), name))
            continue
        clear_scene()
        build_materials()
        try:
            fn()
        except Exception as e:                      # noqa: BLE001
            print("  [%2d/%d] %-16s 失败：%s" % (i, len(names), name, e))
            failed.append(name)
            continue
        size = export_glb(name, os.path.join(OUT, name + ".glb"))
        total_bytes += size
        done.append(name)
        print("  [%2d/%d] %-16s %-10s %6.1f KB  %d obj" %
              (i, len(names), name, ASSET_SPEC[name]["cn"], size / 1024,
               len(bpy.context.scene.objects)))

    if only is None:
        write_manifest(done)
        print("-" * 62)
        print("完成 %d 件，失败 %d 件，合计 %.1f KB" % (len(done), len(failed), total_bytes / 1024))
        print("已写入 assets/glb/manifest.json —— 刷新页面并勾选「GLB 资产」即可替换。")
    else:
        print("（--only 模式不写 manifest.json）")


if __name__ == "__main__":
    main()
