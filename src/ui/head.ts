/**
 * 程序化三维头部 + 14 口型变形目标。
 *
 * 用一个高细分球体做头部，按顶点相对「嘴/唇/下颌/舌位」参考点的位置
 * 定义每个 viseme 的位移场（MorphTarget）。播放时把每帧 14 路权重
 * 加权叠加到 morphTargetInfluences，即可驱动面部动画。
 * 全部几何体代码生成，不依赖外部模型资源。
 */
import * as THREE from 'three';
import { ALL_VISEMES, type VisemeName } from '../core/types';

/** 嘴部中心（头部局部坐标，头为单位球、面朝 +Z）。 */
const MOUTH = new THREE.Vector3(0, -0.28, 0.92);
const UPPER_LIP = new THREE.Vector3(0, -0.16, 0.95);
const LOWER_LIP = new THREE.Vector3(0, -0.4, 0.95);
const JAW = new THREE.Vector3(0, -0.45, 0.8);

type DisplacementFn = (v: THREE.Vector3) => THREE.Vector3;

/** 高斯影响域：离参考点越近位移越大。 */
function falloff(v: THREE.Vector3, center: THREE.Vector3, radius: number): number {
  const d = v.distanceTo(center);
  return Math.exp(-(d * d) / (2 * radius * radius));
}

/** 各口型的顶点位移定义。 */
const VISEME_DEFORM: Record<VisemeName, DisplacementFn> = {
  sil: () => new THREE.Vector3(),
  // 张大嘴：下颌下拉、上下唇分开
  AA: (v) => {
    const open = falloff(v, MOUTH, 0.22);
    return new THREE.Vector3(0, -0.32 * open, 0.05 * open);
  },
  // 展唇半开（e/ie）：嘴角向两侧拉、口微开
  EH: (v) => {
    const p = falloff(v, MOUTH, 0.2);
    const sx = Math.sign(v.x) || 1;
    return new THREE.Vector3(0.18 * sx * p, -0.08 * p, 0.02 * p);
  },
  // 圆唇 o：嘴前突、收圆
  OH: (v) => {
    const p = falloff(v, MOUTH, 0.18);
    return new THREE.Vector3(-0.08 * Math.sign(v.x) * p, -0.06 * p, 0.2 * p);
  },
  // 拢圆突出 u
  OO: (v) => {
    const p = falloff(v, MOUTH, 0.16);
    return new THREE.Vector3(-0.12 * Math.sign(v.x) * p, -0.04 * p, 0.28 * p);
  },
  // 撮口 ü：圆而紧
  IU: (v) => {
    const p = falloff(v, MOUTH, 0.15);
    return new THREE.Vector3(-0.1 * Math.sign(v.x) * p, 0.02 * p, 0.24 * p);
  },
  // 卷舌儿化：舌尖上抬（内部）+ 嘴微开
  ER: (v) => {
    const open = falloff(v, MOUTH, 0.2);
    const tongue = falloff(v, new THREE.Vector3(0, -0.25, 0.85), 0.15);
    return new THREE.Vector3(0, -0.1 * open + 0.15 * tongue, 0.05 * open);
  },
  // 翘舌音：下颌微开、唇略突
  ZH: (v) => {
    const p = falloff(v, MOUTH, 0.18);
    return new THREE.Vector3(-0.04 * Math.sign(v.x) * p, -0.08 * p, 0.1 * p);
  },
  // 平舌音：微开、嘴角略展
  ZS: (v) => {
    const p = falloff(v, MOUTH, 0.18);
    return new THREE.Vector3(0.08 * Math.sign(v.x) * p, -0.07 * p, 0.03 * p);
  },
  // 双唇闭合 b/p/m
  JB: (v) => {
    const up = falloff(v, UPPER_LIP, 0.1);
    const down = falloff(v, LOWER_LIP, 0.1);
    return new THREE.Vector3(0, 0.18 * up - 0.18 * down, 0);
  },
  // 唇齿 f：下唇上提贴上齿
  LD: (v) => {
    const lower = falloff(v, LOWER_LIP, 0.12);
    return new THREE.Vector3(0, 0.2 * lower, 0.05 * lower);
  },
  // 舌尖阻 d/t/n/l：小幅开口
  DT: (v) => {
    const p = falloff(v, MOUTH, 0.2);
    return new THREE.Vector3(0, -0.1 * p, 0.03 * p);
  },
  // 舌根阻 g/k/h：下颌略降、后缩
  GG: (v) => {
    const p = falloff(v, JAW, 0.2);
    return new THREE.Vector3(0, -0.12 * p, -0.08 * p);
  },
  // 舌面阻 j/q/x：展唇微开
  QX: (v) => {
    const p = falloff(v, MOUTH, 0.19);
    return new THREE.Vector3(0.1 * Math.sign(v.x) * p, -0.09 * p, 0.04 * p);
  },
};

export interface Rig {
  group: THREE.Group;
  head: THREE.Mesh;
  /** 与 ALL_VISEMES 同序的 morphTarget 索引。 */
  visemeTargets: Record<VisemeName, number>;
  /** 应用一帧 14 路权重。 */
  applyWeights: (weights: number[]) => void;
  /** 复位到静音。 */
  reset: () => void;
}

/** 构建带口型变形目标的头部。 */
export function createHead(): Rig {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(1, 64, 48);

  // 基准顶点（未变形）。
  const base = geometry.attributes.position.array.slice();
  const morphPositions: Float32Array[] = [];
  const visemeTargets = {} as Record<VisemeName, number>;

  ALL_VISEMES.forEach((name, idx) => {
    const deform = VISEME_DEFORM[name];
    const displaced = new Float32Array(base.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      v.fromArray(base, i * 3);
      const d = deform(v);
      displaced[i * 3] = v.x + d.x;
      displaced[i * 3 + 1] = v.y + d.y;
      displaced[i * 3 + 2] = v.z + d.z;
    }
    morphPositions.push(displaced);
    visemeTargets[name] = idx;
  });
  geometry.morphAttributes.position = morphPositions.map((arr) => {
    const attr = new THREE.Float32BufferAttribute(arr, 3);
    attr.name = 'morph';
    return attr;
  });

  const material = new THREE.MeshStandardMaterial({
    color: 0xe8b894, roughness: 0.65, metalness: 0.05,
  });
  const head = new THREE.Mesh(geometry, material);
  group.add(head);

  // 简单五官：眼睛（两个小球）帮助辨识朝向。
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3 });
  const eyeGeo = new THREE.SphereGeometry(0.07, 16, 12);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0.32 * sx, 0.22, 0.9);
    group.add(eye);
  }
  // 鼻子。
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.22, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8a582, roughness: 0.7 }),
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.02, 1.02);
  group.add(nose);

  const influences = head.morphTargetInfluences!;
  const applyWeights = (weights: number[]): void => {
    for (let i = 0; i < ALL_VISEMES.length; i++) {
      influences[i] = THREE.MathUtils.clamp(weights[i] ?? 0, 0, 1);
    }
  };
  const reset = (): void => applyWeights(new Array(ALL_VISEMES.length).fill(0));

  return { group, head, visemeTargets, applyWeights, reset };
}
