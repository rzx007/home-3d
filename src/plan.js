/**
 * plan.js —— 户型数据（单位：米）
 *
 * 坐标系：X 向东(右)，Z 向南(下)，Y 向上。北墙在 z≈0，南墙在 z≈7.2。
 * 建筑面积 73㎡ / 套内 62.6㎡（得房率 ≈86%），两室一厅，其中一个房间是"第二间房"。
 *
 * 所有户型信息只在这里定义一次：3D 建模、2D 户型图、房间卡片、面积统计、
 * 家具布置、碰撞盒、迷你地图全部从这一份数据推导，避免多处维护不一致。
 */

export const SHELL = {
  W: 9.6,          // 东西向总宽
  D: 7.2,          // 南北向总深
  extT: 0.2,       // 外墙厚
  intT: 0.12,      // 内墙厚
  H: 2.75,         // 净层高
  slab: 0.18,      // 楼板厚
  cutH: 1.35,      // 1.35m 剖切高度
  plot: 0.62,      // 基座外扩（模型底座）
  garb: 0.06,      // 墙内外表面到"墙面"的贴面偏移
};

export const AREA_TOTAL = 73.0; // 建筑面积（含公摊）

/** 房间。rects 支持多矩形（L 形房间），面积自动累加。 */
const ROOMS_RAW = [
  {
    id: 'master', name: '主卧', en: 'Master Bedroom',
    rects: [[0.2, 0.2, 3.7, 3.6]],
    floor: 'wood', tint: 0xd9c4a3,
    desc: '南向大床房，衣柜贴南墙，床头墙面留白挂画。',
  },
  {
    id: 'roomB', name: '第二间房', en: 'Second Room',
    rects: [[3.7, 0.2, 6.2, 3.6]],
    floor: 'wood', tint: 0xc7b393,
    desc: '本户型的关键变量：同一房间在三种生活方式下承担不同角色。',
  },
  {
    id: 'hall', name: '过道', en: 'Corridor',
    rects: [[6.2, 0.2, 7.2, 3.6]],
    floor: 'wood', tint: 0xcdbda6,
    desc: '串联两间卧室、厨房与卫生间的 1.0m 走廊。',
  },
  {
    id: 'kitchen', name: '厨房', en: 'Kitchen',
    rects: [[7.2, 0.2, 9.4, 2.0]],
    floor: 'tile', tint: 0xd8d5cd,
    desc: '2.2×1.8m 一字型厨房，水槽对窗，灶台靠东墙。',
  },
  {
    id: 'bath', name: '卫生间', en: 'Bathroom',
    rects: [[7.2, 2.0, 9.4, 3.6]],
    floor: 'tile', tint: 0xd2cfc7,
    desc: '2.2×1.6m 干湿分离，淋浴房 + 高窗采光。',
  },
  {
    id: 'living', name: '客厅', en: 'Living Room',
    rects: [[0.2, 3.6, 4.3, 7.0]],
    floor: 'wood', tint: 0xd9c4a3,
    desc: '4.1m 电视墙，南向 3.0m 落地窗，与餐厅连通。',
  },
  {
    id: 'dining', name: '餐厅', en: 'Dining',
    rects: [[4.3, 3.6, 7.3, 7.0]],
    floor: 'wood', tint: 0xcdbda6,
    desc: '1.4m 四人餐桌居中，兼作入户过渡与家务动线。',
  },
  {
    id: 'entry', name: '玄关·家政', en: 'Entry & Utility',
    rects: [[7.3, 3.6, 9.4, 7.0]],
    floor: 'tile', tint: 0xd6d3ca,
    desc: '入户落尘区 + 洗衣家政区，鞋柜、换鞋凳、洗衣机柜一次排开。',
  },
];

export const ROOMS = ROOMS_RAW.map((r) => {
  let area = 0;
  for (const [x0, z0, x1, z1] of r.rects) area += (x1 - x0) * (z1 - z0);
  let cx = 0, cz = 0, wsum = 0;
  for (const [x0, z0, x1, z1] of r.rects) {
    const a = (x1 - x0) * (z1 - z0);
    cx += ((x0 + x1) / 2) * a; cz += ((z0 + z1) / 2) * a; wsum += a;
  }
  return { ...r, area: Math.round(area * 100) / 100, cx: cx / wsum, cz: cz / wsum };
});

export const ROOM_BY_ID = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
export const AREA_NET = Math.round(ROOMS.reduce((s, r) => s + r.area, 0) * 100) / 100;

export const roomAt = (x, z) => {
  for (const r of ROOMS) {
    for (const [x0, z0, x1, z1] of r.rects) {
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return r;
    }
  }
  return null;
};

/**
 * 墙体。axis:'x' 表示沿 X 走向、位置在 z=at；axis:'z' 反之。
 * openings 沿墙走向定位；t: 'win' 窗 | 'door' 门洞 | 'pass' 通口。
 */
export const WALLS = [
  {
    id: 'ext-n', axis: 'x', at: 0.1, from: 0.0, to: 9.6, t: SHELL.extT, kind: 'ext', side: 'N',
    openings: [
      { t: 'win', a: 1.1, b: 3.0, sill: 0.9, head: 2.4, panes: 2 },
      { t: 'win', a: 4.0, b: 5.9, sill: 0.9, head: 2.4, panes: 2 },
      { t: 'win', a: 7.7, b: 9.0, sill: 1.0, head: 2.4, panes: 1 },
    ],
  },
  {
    id: 'ext-s', axis: 'x', at: 7.1, from: 0.0, to: 9.6, t: SHELL.extT, kind: 'ext', side: 'S',
    openings: [
      { t: 'win', a: 0.9, b: 3.9, sill: 0.12, head: 2.5, panes: 3, french: true, label: '客厅落地窗' },
      { t: 'door', a: 7.8, b: 8.7, head: 2.15, label: '入户门' },
    ],
  },
  { id: 'ext-w', axis: 'z', at: 0.1, from: 0.0, to: 7.2, t: SHELL.extT, kind: 'ext', side: 'W', openings: [] },
  {
    id: 'ext-e', axis: 'z', at: 9.5, from: 0.0, to: 7.2, t: SHELL.extT, kind: 'ext', side: 'E',
    openings: [{ t: 'win', a: 2.45, b: 3.25, sill: 1.5, head: 2.3, panes: 1, label: '卫生间高窗' }],
    // 卫生间墙砖（沿墙线段 + 高度）
    linings: [{ side: '-x', from: 2.06, to: 3.54, h: 2.2 }],
  },
  { id: 'w-mb', axis: 'z', at: 3.7, from: 0.2, to: 3.6, t: SHELL.intT, kind: 'int', side: 'W', openings: [] },
  {
    id: 'w-bh', axis: 'z', at: 6.2, from: 0.2, to: 3.6, t: SHELL.intT, kind: 'int', side: 'E',
    openings: [{ t: 'door', a: 2.5, b: 3.35, head: 2.1 }],
  },
  {
    id: 'w-hk', axis: 'z', at: 7.2, from: 0.2, to: 3.6, t: SHELL.intT, kind: 'int', side: 'E',
    openings: [
      { t: 'door', a: 0.95, b: 1.85, head: 2.1 },
      { t: 'door', a: 2.8, b: 3.55, head: 2.1 },
    ],
    linings: [{ side: '+x', from: 2.06, to: 3.54, h: 2.2 }],
  },
  {
    id: 'w-kb', axis: 'x', at: 2.0, from: 7.2, to: 9.4, t: SHELL.intT, kind: 'int', side: 'N', openings: [],
    linings: [{ side: '+z', from: 7.26, to: 9.34, h: 2.2 }],
  },
  {
    id: 'w-ns', axis: 'x', at: 3.6, from: 0.2, to: 9.4, t: SHELL.intT, kind: 'int', side: 'S',
    openings: [
      { t: 'door', a: 2.7, b: 3.55, head: 2.1 },
      { t: 'pass', a: 6.2, b: 7.2, head: 2.3, label: '过道通口' },
    ],
    linings: [{ side: '-z', from: 7.26, to: 9.34, h: 2.2 }],
  },
  {
    id: 'w-ld', axis: 'z', at: 4.3, from: 3.6, to: 7.0, t: SHELL.intT, kind: 'int', side: 'E',
    openings: [{ t: 'pass', a: 4.3, b: 7.0, head: 2.35, label: '客厅↔餐厅' }],
  },
  {
    id: 'w-de', axis: 'z', at: 7.3, from: 3.6, to: 7.0, t: SHELL.intT, kind: 'int', side: 'W',
    openings: [{ t: 'pass', a: 3.9, b: 5.9, head: 2.35, label: '餐厅↔玄关' }],
  },
];

/**
 * 门扇。hinge=[x,z] 为铰链位置；openAngle 为完全打开时的弧度（正负决定内外开向）。
 * 全部为木门（浅橡木），门框独立建模。
 */
export const DOORS = [
  { id: 'd-master', wall: 'w-ns', name: '主卧门', a: 2.7, b: 3.55, head: 2.1, hinge: [2.7, 3.6], openAngle: 1.6, out: -1, leaf: 0.045 },
  { id: 'd-roomB', wall: 'w-bh', name: '第二间房门', a: 2.5, b: 3.35, head: 2.1, hinge: [6.2, 3.35], openAngle: 1.55, out: 0, leaf: 0.045 },
  { id: 'd-kitchen', wall: 'w-hk', name: '厨房门', a: 0.95, b: 1.85, head: 2.1, hinge: [7.2, 0.95], openAngle: 1.55, out: 0, leaf: 0.045 },
  { id: 'd-bath', wall: 'w-hk', name: '卫生间门', a: 2.8, b: 3.55, head: 2.1, hinge: [7.2, 3.55], openAngle: -1.55, out: 0, leaf: 0.045 },
  { id: 'd-entry', wall: 'ext-s', name: '入户门', a: 7.8, b: 8.7, head: 2.15, hinge: [8.7, 7.1], openAngle: -1.57, out: 0, leaf: 0.055, security: true },
];

export const wallById = (id) => WALLS.find((w) => w.id === id);

/* ------------------------------------------------------------------ *
 * 家具布置
 * t: 家具类型；x/z: 落地中心点；y: 离地高度（默认 0，墙挂件必填）；
 * rot: 绕 Y 轴角度（度）。约定：模型"正面"朝向 +Z，rot=0 即朝南。
 * ------------------------------------------------------------------ */

const MASTER = [
  { t: 'bed_double', x: 1.2, z: 1.9, rot: 90, o: { w: 1.5, l: 2.0 } },
  { t: 'nightstand', x: 0.42, z: 0.92, rot: 90 },
  { t: 'nightstand', x: 0.42, z: 2.88, rot: 90 },
  { t: 'table_lamp', x: 0.42, z: 0.92, y: 0.5, rot: 90, light: { intensity: 5, dist: 4.5, color: 0xffcf9a } },
  { t: 'table_lamp', x: 0.42, z: 2.88, y: 0.5, rot: 90, light: { intensity: 5, dist: 4.5, color: 0xffcf9a } },
  { t: 'wardrobe', x: 1.2, z: 3.3, rot: 180, o: { w: 2.0, d: 0.6, h: 2.2 } },
  { t: 'rug', x: 2.95, z: 1.9, o: { w: 1.3, d: 1.7 } },
  { t: 'wall_art', x: 0.23, z: 1.9, y: 1.62, rot: 90, o: { w: 1.1, h: 0.78 } },
  { t: 'floor_lamp', x: 3.35, z: 0.6, light: { intensity: 6, dist: 5, color: 0xffcf9a } },
  { t: 'plant', x: 2.4, z: 0.6, o: { h: 0.95 } },
];

const HALL = [
  { t: 'wall_art', x: 6.27, z: 1.4, y: 1.58, rot: 90, o: { w: 0.8, h: 0.58 } },
  { t: 'side_table', x: 6.42, z: 0.95, rot: 90, o: { w: 0.9, d: 0.3, h: 0.78 } },
  { t: 'ceiling_lamp', x: 6.7, z: 1.9, y: 2.58, o: { w: 0.26 }, light: { intensity: 6, dist: 4, color: 0xffd7ac } },
];

const KITCHEN = [
  { t: 'kitchen_counter', x: 7.95, z: 0.52, o: { w: 1.3, d: 0.6 } },
  { t: 'sink', x: 7.95, z: 0.52, y: 0.86 },
  { t: 'fridge', x: 9.05, z: 0.53, rot: 180, o: { w: 0.6, d: 0.65, h: 1.85 } },
  { t: 'kitchen_counter', x: 9.1, z: 1.45, rot: -90, o: { w: 0.85, d: 0.6 } },
  { t: 'stove', x: 9.1, z: 1.55, y: 0.86, rot: -90 },
  { t: 'range_hood', x: 9.14, z: 1.55, y: 1.72, rot: -90, o: { w: 0.6, d: 0.52 } },
  { t: 'wall_cabinet', x: 9.05, z: 0.38, y: 2.36, rot: 0, o: { w: 0.6, d: 0.36, h: 0.7 } },
];

const BATH = [
  { t: 'shower', x: 8.9, z: 2.55, rot: -90, o: { w: 0.9, d: 0.9, h: 2.0 } },
  { t: 'toilet', x: 7.6, z: 2.41, o: { w: 0.68, d: 0.7 } },
  { t: 'vanity', x: 8.7, z: 3.38, rot: 180, o: { w: 0.8, d: 0.45, h: 0.85 } },
  { t: 'mirror_cabinet', x: 8.7, z: 3.53, y: 1.35, rot: 180, o: { w: 0.8, h: 0.8, d: 0.14 } },
];

const LIVING = [
  { t: 'tv_console', x: 0.41, z: 5.3, rot: 90, o: { w: 1.8, d: 0.42, h: 0.45 } },
  { t: 'tv', x: 0.26, z: 5.3, y: 1.12, rot: 90, o: { w: 1.3, h: 0.74, d: 0.05 } },
  { t: 'sofa_3seat', x: 3.05, z: 5.3, rot: -90, o: { w: 2.1, d: 0.92, h: 0.78 } },
  { t: 'coffee_table', x: 1.7, z: 5.3, rot: 90, o: { w: 1.1, d: 0.55, h: 0.4 } },
  { t: 'armchair', x: 1.05, z: 6.45, rot: 150, o: { w: 0.78, d: 0.82, h: 0.76 } },
  { t: 'side_table', x: 1.95, z: 6.5, rot: 0, o: { w: 0.45, d: 0.45, h: 0.52 } },
  { t: 'rug', x: 2.0, z: 5.3, o: { w: 2.4, d: 1.7 } },
  { t: 'floor_lamp', x: 3.85, z: 6.6, light: { intensity: 7, dist: 5.5, color: 0xffcf9a } },
  { t: 'plant', x: 3.85, z: 4.1, o: { h: 1.15 } },
  { t: 'wall_art', x: 4.23, z: 3.95, y: 1.6, rot: -90, o: { w: 0.9, h: 0.6 } },
  { t: 'ceiling_lamp', x: 2.25, z: 5.3, y: 2.5, o: { w: 0.45 }, light: { intensity: 26, dist: 8, color: 0xffd9a8, shadow: true } },
];

const DINING = [
  { t: 'dining_table', x: 5.2, z: 5.6, o: { w: 1.4, d: 0.8, h: 0.75 } },
  { t: 'dining_chair', x: 4.75, z: 4.96, rot: 180 },
  { t: 'dining_chair', x: 5.65, z: 4.96, rot: 180 },
  { t: 'dining_chair', x: 4.75, z: 6.24, rot: 0 },
  { t: 'dining_chair', x: 5.65, z: 6.24, rot: 0 },
  { t: 'rug', x: 5.25, z: 5.65, o: { w: 1.9, d: 1.9 } },
  { t: 'sideboard', x: 4.95, z: 3.87, rot: 180, o: { w: 1.2, d: 0.42, h: 0.8 } },
  { t: 'plant', x: 6.95, z: 6.6, o: { h: 1.1 } },
  { t: 'ceiling_lamp', x: 5.2, z: 5.6, y: 2.3, o: { w: 0.42, drop: 0.5 }, light: { intensity: 22, dist: 7.5, color: 0xffd9a8, shadow: true } },
];

const ENTRY = [
  { t: 'shoe_cabinet', x: 7.5, z: 6.4, rot: 90, o: { w: 1.2, d: 0.35, h: 1.1 } },
  { t: 'bench', x: 9.1, z: 6.45, rot: -90, o: { w: 0.9, d: 0.38, h: 0.42 } },
  { t: 'coat_rack', x: 9.1, z: 5.65, rot: -90 },
  { t: 'washer', x: 9.07, z: 4.4, rot: -90, o: { w: 0.6, d: 0.62, h: 0.86 } },
  { t: 'plant', x: 9.05, z: 3.8, o: { h: 0.9 } },
  { t: 'wall_art', x: 9.36, z: 6.45, y: 1.55, rot: -90, o: { w: 0.7, h: 0.9, mirror: true } },
  { t: 'ceiling_lamp', x: 8.35, z: 5.3, y: 2.56, o: { w: 0.3 }, light: { intensity: 8, dist: 4.5, color: 0xffd7ac } },
];

export const BASE_LAYOUT = {
  master: MASTER,
  hall: HALL,
  kitchen: KITCHEN,
  bath: BATH,
  living: LIVING,
  dining: DINING,
  entry: ENTRY,
};

/* ------------------------------------------------------------------ *
 * 三种生活方式：第二间房的三份答案 + 整屋联动
 * ------------------------------------------------------------------ */

export const MODES = [
  {
    id: 'work',
    name: '在家工作',
    tag: '第二间房 = 书房 / 工作室',
    blurb: '把最好的采光留给工位：升降桌贴着北窗，右侧落地灯补光，左侧文件柜压住动线。客厅少一把单椅，多一组边柜收工位物资。',
    changes: ['次卧 → 书房', '客厅 −单人椅 +边柜', '餐厅 +1 折叠餐椅', '过道 +挂画'],
    accent: 0x7c8a76,
    room: [
      { t: 'desk', x: 4.95, z: 0.58, o: { w: 1.4, d: 0.7, h: 0.75, lift: true } },
      { t: 'monitor', x: 4.95, z: 0.44, y: 0.78, o: { w: 0.62 } },
      { t: 'desk_chair', x: 4.95, z: 1.44, rot: 180 },
      { t: 'pegboard', x: 4.95, z: 0.27, y: 1.42, o: { w: 1.2, h: 0.72 } },
      { t: 'bookshelf', x: 6.02, z: 1.2, rot: -90, o: { w: 1.0, d: 0.32, h: 1.8 } },
      { t: 'filing_cabinet', x: 3.93, z: 1.2, rot: 90, o: { w: 0.42, d: 0.5, h: 0.62 } },
      { t: 'armchair', x: 4.4, z: 2.62, rot: 35, o: { w: 0.7, d: 0.72, h: 0.74 } },
      { t: 'side_table', x: 5.2, z: 2.9, rot: 0, o: { w: 0.42, d: 0.42, h: 0.5 } },
      { t: 'floor_lamp', x: 3.95, z: 2.85, light: { intensity: 12, dist: 5, color: 0xfff0d8 } },
      { t: 'rug', x: 4.95, z: 2.2, o: { w: 1.8, d: 1.5 } },
      { t: 'plant', x: 5.88, z: 0.62, o: { h: 1.0 } },
      { t: 'ceiling_lamp', x: 4.95, z: 1.9, y: 2.62, o: { w: 0.34 }, light: { intensity: 18, dist: 6.5, color: 0xfff2e0 } },
    ],
    add: {
      living: [
        { t: 'sideboard', x: 1.35, z: 4.05, rot: 180, o: { w: 1.3, d: 0.42, h: 0.78 } },
        { t: 'plant', x: 0.6, z: 4.2, o: { h: 0.85 } },
      ],
      dining: [{ t: 'dining_chair', x: 5.75, z: 5.6, rot: 90 }],
      entry: [{ t: 'coat_rack', x: 7.5, z: 3.85, rot: 90 }],
    },
    remove: { living: ['armchair', 'side_table'] },
  },
  {
    id: 'guest',
    name: '朋友留宿',
    tag: '第二间房 = 客卧 / 沙发床',
    blurb: '平时是一间可以坐着聊天的房间，朋友来了把沙发床铺开就是一张 1.5m 的床。衣柜留出半格给客人，客厅加两把折叠椅。',
    changes: ['次卧 → 客卧', '客厅 +2 折叠椅', '玄关 +行李凳', '过道 −挂画'],
    accent: 0x8a8f9c,
    room: [
      { t: 'sofa_bed', x: 5.72, z: 1.6, rot: -90, o: { w: 1.5, d: 0.95, h: 0.78 } },
      { t: 'coffee_table', x: 4.85, z: 1.6, rot: 0, o: { w: 0.9, d: 0.5, h: 0.38 } },
      { t: 'nightstand', x: 5.75, z: 0.55, rot: 0 },
      { t: 'table_lamp', x: 5.75, z: 0.55, y: 0.5, rot: 0, light: { intensity: 5, dist: 4.5, color: 0xffcf9a } },
      { t: 'wardrobe', x: 4.3, z: 3.28, rot: 180, o: { w: 1.2, d: 0.6, h: 2.2 } },
      { t: 'floor_lamp', x: 3.98, z: 0.72, light: { intensity: 10, dist: 5, color: 0xffe6c4 } },
      { t: 'rug', x: 4.95, z: 1.95, o: { w: 1.9, d: 1.3 } },
      { t: 'plant', x: 3.98, z: 2.6, o: { h: 1.0 } },
      { t: 'wall_art', x: 3.77, z: 1.6, y: 1.5, rot: 90, o: { w: 0.9, h: 0.66 } },
      { t: 'ceiling_lamp', x: 4.95, z: 1.9, y: 2.62, o: { w: 0.34 }, light: { intensity: 18, dist: 6.5, color: 0xfff2e0 } },
    ],
    add: {
      living: [
        { t: 'dining_chair', x: 2.3, z: 6.5, rot: 0 },
        { t: 'dining_chair', x: 2.85, z: 6.5, rot: 0 },
      ],
      entry: [{ t: 'bench', x: 7.75, z: 3.9, rot: 90, o: { w: 0.8, d: 0.36, h: 0.42 } }],
    },
    remove: { hall: ['wall_art'] },
  },
  {
    id: 'future',
    name: '留给未来',
    tag: '第二间房 = 儿童房',
    blurb: '先按儿童房布置：婴儿床贴着北窗，尿布台与成长尺靠西墙，摇椅放在屋角。客厅角上放一个玩具筐，餐桌加一把儿童椅。',
    changes: ['次卧 → 儿童房', '客厅 +玩具收纳 +爬行垫', '餐厅 +儿童椅', '夜里留一盏小夜灯'],
    accent: 0xb08968,
    room: [
      { t: 'crib', x: 4.95, z: 0.62, o: { w: 1.2, d: 0.66, h: 0.92 } },
      { t: 'changing_table', x: 3.98, z: 1.45, rot: 90, o: { w: 0.9, d: 0.55, h: 0.92 } },
      { t: 'growth_chart', x: 3.77, z: 2.75, y: 0.05, rot: 90, o: { w: 0.24, h: 1.5 } },
      { t: 'rocking_chair', x: 5.5, z: 2.05, rot: 235, o: { w: 0.72, d: 0.82, h: 0.86 } },
      { t: 'toy_bin', x: 5.7, z: 1.05, rot: 0, o: { w: 0.46, d: 0.46, h: 0.5 } },
      { t: 'toy_bin', x: 5.7, z: 0.52, rot: 0, o: { w: 0.46, d: 0.46, h: 0.4 } },
      { t: 'play_mat', x: 4.6, z: 2.5, o: { w: 1.8, d: 1.5 } },
      { t: 'floor_lamp', x: 3.98, z: 3.05, light: { intensity: 5, dist: 4, color: 0xffd2a0 } },
      { t: 'nightlight', x: 5.62, z: 3.15, y: 0.06, light: { intensity: 3.5, dist: 2.6, color: 0xffb877, nightOnly: true } },
      { t: 'ceiling_lamp', x: 4.95, z: 1.9, y: 2.62, o: { w: 0.34 }, light: { intensity: 14, dist: 6, color: 0xfff0dd } },
    ],
    add: {
      living: [
        { t: 'toy_bin', x: 3.4, z: 6.5, rot: 0, o: { w: 0.44, d: 0.44, h: 0.46 } },
        { t: 'play_mat', x: 2.6, z: 4.35, o: { w: 1.6, d: 1.1 } },
      ],
      dining: [{ t: 'dining_chair', x: 5.2, z: 4.5, rot: 180, o: { w: 0.42, d: 0.44, child: true } }],
    },
    remove: {},
  },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));

/** 生成某模式下的整屋家具清单（基础布置 + 增删改动）。 */
export function furnitureFor(modeId) {
  const mode = MODE_BY_ID[modeId];
  const out = [];
  for (const room of ROOMS) {
    const base = BASE_LAYOUT[room.id] || [];
    const rm = (mode.remove && mode.remove[room.id]) || [];
    const add = (mode.add && mode.add[room.id]) || [];
    for (const item of base) if (!rm.includes(item.t)) out.push({ ...item, room: room.id });
    for (const item of add) out.push({ ...item, room: room.id, added: true });
  }
  for (const item of mode.room) out.push({ ...item, room: 'roomB', added: true, key: true });
  return out;
}

/** 家具中文名（卡片清单用）。 */
export const FURNITURE_NAMES = {
  bed_double: '双人床 1.5m', bed_single: '单人床 1.2m', crib: '婴儿床',
  nightstand: '床头柜', wardrobe: '衣柜 2.0m', desk: '升降书桌 1.4m',
  desk_chair: '人体工学椅', monitor: '显示器', pegboard: '洞洞板',
  bookshelf: '书架', filing_cabinet: '文件柜', armchair: '单人沙发',
  sofa_3seat: '三人沙发', sofa_2seat: '双人沙发', sofa_bed: '沙发床 1.5m',
  coffee_table: '茶几', side_table: '边几', tv_console: '电视柜', tv: '电视 55"',
  dining_table: '餐桌 1.4m', dining_chair: '餐椅', sideboard: '餐边柜',
  shoe_cabinet: '鞋柜', bench: '换鞋凳', coat_rack: '衣帽架', washer: '洗衣机',
  kitchen_counter: '橱柜地柜', sink: '水槽', stove: '燃气灶', range_hood: '油烟机',
  fridge: '冰箱', wall_cabinet: '吊柜', toilet: '马桶', vanity: '浴室柜',
  shower: '淋浴房', mirror_cabinet: '镜柜', changing_table: '尿布台',
  rocking_chair: '摇椅', toy_bin: '玩具收纳筐', growth_chart: '成长尺',
  play_mat: '游戏爬行垫', rug: '地毯', wall_art: '挂画 / 镜子', plant: '绿植',
  floor_lamp: '落地灯', table_lamp: '台灯', ceiling_lamp: '吊灯', nightlight: '小夜灯',
};

/** 房间卡片：列出该房间在指定模式下的家具清单。 */
export function roomCard(roomId, modeId) {
  const room = ROOM_BY_ID[roomId];
  const items = furnitureFor(modeId).filter((f) => f.room === roomId);
  const dims = room.rects.map(([x0, z0, x1, z1]) => `${(x1 - x0).toFixed(2)}×${(z1 - z0).toFixed(2)}`);
  const wallNames = [];
  for (const w of WALLS) {
    for (const op of w.openings) {
      if (!op.label) continue;
      const [ox, oz] = [w.axis === 'x' ? (op.a + op.b) / 2 : w.at, w.axis === 'x' ? w.at : (op.a + op.b) / 2];
      const r = roomAt(ox, oz);
      if (r && r.id === roomId) wallNames.push(op.label);
    }
  }
  const doors = DOORS.filter((d) => {
    const wall = wallById(d.wall);
    const [ox, oz] = [wall.axis === 'x' ? (d.a + d.b) / 2 : wall.at, wall.axis === 'x' ? wall.at : (d.a + d.b) / 2];
    const r = roomAt(ox, oz);
    return r && r.id === roomId;
  }).map((d) => d.name);
  const lamps = items.filter((i) => i.light).length;
  return {
    room, dims, openings: [...wallNames, ...doors], items, lampCount: lamps,
    floorName: room.floor === 'wood' ? '浅橡木地板' : room.floor === 'tile' ? '哑光水磨石砖' : '石材',
  };
}

export const PLAN = { SHELL, ROOMS, WALLS, DOORS, MODES, BASE_LAYOUT };
export default PLAN;
