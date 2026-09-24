/** Layer sampling, polygon expansion and skin weights, ported from
 * lib-fbx tools/fbx-viewer/src/fbx-three-geometry.ts.
 */
import { BufferAttribute, BufferGeometry } from "three";

export type LayerData = {
  direct: ArrayLike<number>;
  index?: ArrayLike<number>;
  comps: number;
  mapping: "ByControlPoint" | "ByPolygonVertex" | "ByPolygon" | "AllSame";
  indexed: boolean;
};

export type SkinInfluence = [boneIndex: number, weight: number];

export type SkinClusterData = {
  boneIndex: number;
  indices: ArrayLike<number>;
  weights: ArrayLike<number>;
};

export function sampleLayer(layer: LayerData | null | undefined, cp: number, pvi: number, poly: number): number[] {
  if (!layer) return [];
  const { direct, index, comps, mapping, indexed } = layer;
  let slot = pvi;
  if (mapping === "ByControlPoint") slot = cp;
  else if (mapping === "ByPolygon") slot = poly;
  else if (mapping === "AllSame") slot = 0;
  const di = indexed ? Number(index?.[slot] ?? slot) : slot;
  const out: number[] = [];
  for (let c = 0; c < comps; c++) out.push(Number(direct[di * comps + c] ?? 0));
  return out;
}

export function polygons(pvi: ArrayLike<number>): Array<{ cps: number[]; pvis: number[] }> {
  const out: Array<{ cps: number[]; pvis: number[] }> = [];
  let start = 0;
  for (let i = 0; i < pvi.length; i++) {
    const v = pvi[i] ?? 0;
    if (v >= 0) continue;
    const cps: number[] = [];
    const pvis: number[] = [];
    for (let j = start; j < i; j++) {
      cps.push(pvi[j] ?? 0);
      pvis.push(j);
    }
    cps.push(-v - 1);
    pvis.push(i);
    if (cps.length >= 3) out.push({ cps, pvis });
    start = i + 1;
  }
  return out;
}

export function buildSkinInfluences(clusters: SkinClusterData[], cpCount: number): SkinInfluence[][] {
  const list: SkinInfluence[][] = Array.from({ length: cpCount }, () => []);
  for (const cluster of clusters) {
    const n = Math.min(cluster.indices.length, cluster.weights.length);
    for (let i = 0; i < n; i++) {
      const cp = Number(cluster.indices[i] ?? 0);
      const w = Number(cluster.weights[i] ?? 0);
      if (cp < 0 || cp >= cpCount || w === 0) continue;
      list[cp].push([cluster.boneIndex, w]);
    }
  }
  return list.map(inf => {
    inf.sort((a, b) => b[1] - a[1]);
    const top = inf.slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
    return top.map(([i, w]) => [i, w / sum]);
  });
}

type MeshGeometryData = {
  controlPoints: ArrayLike<number>;
  polygonIndexes: ArrayLike<number>;
  normals?: LayerData | null;
  uvs?: LayerData | null;
  uv2?: LayerData | null;
  colors?: LayerData | null;
  materials?: LayerData | null;
  influences?: SkinInfluence[][] | null;
};

export function buildMeshGeometry(data: MeshGeometryData): BufferGeometry | null {
  const { controlPoints: cps, normals, uvs, uv2, colors, materials, influences: infl } = data;
  if (Math.floor(cps.length / 3) === 0) return null;
  const polys = polygons(data.polygonIndexes);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const uvB: number[] = [];
  const col: number[] = [];
  const sidx: number[] = [];
  const sw: number[] = [];
  const groups: Array<{ start: number; count: number; materialIndex: number }> = [];
  let cursor = 0;
  let currentMat = 0;
  let groupStart = 0;
  const flush = () => {
    const count = cursor - groupStart;
    if (count > 0) groups.push({ start: groupStart, count, materialIndex: currentMat });
    groupStart = cursor;
  };

  for (let pi = 0; pi < polys.length; pi++) {
    const poly = polys[pi];
    const matIndex = Number(sampleLayer(materials, poly.cps[0] ?? 0, poly.pvis[0] ?? 0, pi)[0] ?? 0);
    if (matIndex !== currentMat && cursor > 0) flush();
    currentMat = matIndex;
    for (let k = 1; k + 1 < poly.cps.length; k++) {
      for (const c of [0, k, k + 1]) {
        const cp = poly.cps[c] ?? 0;
        const pv = poly.pvis[c] ?? 0;
        pos.push(cps[cp * 3] ?? 0, cps[cp * 3 + 1] ?? 0, cps[cp * 3 + 2] ?? 0);
        const n = sampleLayer(normals, cp, pv, pi);
        if (n.length >= 3) nrm.push(n[0], n[1], n[2]);
        const u = sampleLayer(uvs, cp, pv, pi);
        if (u.length >= 2) uv.push(u[0], u[1]);
        const u2 = sampleLayer(uv2, cp, pv, pi);
        if (u2.length >= 2) uvB.push(u2[0], u2[1]);
        const vc = sampleLayer(colors, cp, pv, pi);
        if (vc.length >= 3) col.push(vc[0], vc[1], vc[2]);
        if (infl) {
          const inf = infl[cp] ?? [];
          sidx.push(inf[0]?.[0] ?? 0, inf[1]?.[0] ?? 0, inf[2]?.[0] ?? 0, inf[3]?.[0] ?? 0);
          if (inf.length === 0) sw.push(1, 0, 0, 0);
          else sw.push(inf[0]?.[1] ?? 0, inf[1]?.[1] ?? 0, inf[2]?.[1] ?? 0, inf[3]?.[1] ?? 0);
        }
        cursor++;
      }
    }
  }
  flush();
  if (pos.length === 0) return null;

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  if (nrm.length === pos.length) {
    geo.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  } else {
    geo.computeVertexNormals();
  }
  if (uv.length * 3 === pos.length * 2) geo.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  if (uvB.length * 3 === pos.length * 2) geo.setAttribute("uv2", new BufferAttribute(new Float32Array(uvB), 2));
  if (col.length === pos.length) geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  if (sidx.length) {
    geo.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(sidx), 4));
    geo.setAttribute("skinWeight", new BufferAttribute(new Float32Array(sw), 4));
  }
  for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
  return geo;
}
