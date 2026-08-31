// Shared three.js helpers between index.html (Studio mirror, fetch-once scene.json)
// and stage.html (live SSE build-op preview). Kept as one module so the Roblox->three.js
// conversion and geometry mapping can't drift between the two pages.
import * as THREE from "three";
import { ADDITION, INTERSECTION, SUBTRACTION, Brush, Evaluator } from "three-bvh-csg";

// Roblox and three.js use the SAME coordinate system: right-handed, Y-up, forward = -Z
// (Roblox's CFrame.LookVector is its -Z column). The earlier code assumed Roblox was
// left-handed and negated Z plus two Euler angles — that mirrored the scene, and because
// the position mirror and the angle flips did not correspond, compound-angle geometry came
// apart: tree limbs drooped instead of sweeping up and detached from the trunk. Vertical
// trunks and radially symmetric roots hid it, which is why it survived so long.
//
// ToOrientation() returns YXZ-ordered radians, which is exactly three.js Euler order 'YXZ',
// so the whole conversion is the identity.
export function robloxToThreePos(p) {
  return new THREE.Vector3(p[0], p[1], p[2]);
}
export function robloxToThreeEuler(r) {
  return new THREE.Euler(r[0], r[1], r[2], "YXZ");
}
// Accepts both vocabularies: scene_dump's capitalized Roblox Part.Shape names
// ("Ball"/"Cylinder"/"Block"/...) and BUILD_SPEC's lowercase op shapes
// ("ball"/"cylinder"/"box"/"wedge").
export function geometryFor(shape, size) {
  const [sx, sy, sz] = size;
  switch ((shape || "").toLowerCase()) {
    case "ball":
      return new THREE.SphereGeometry(Math.max(sx, sy, sz) / 2, 20, 14);
    case "cylinder": {
      // Roblox cylinder axis is local X; three.js CylinderGeometry axis is local Y —
      // build it Y-axis-native then rotate 90deg about Z so length rides local X.
      const g = new THREE.CylinderGeometry(sy / 2, sy / 2, sx, 20);
      g.rotateZ(Math.PI / 2);
      return g;
    }
    default:
      // box/block/wedge/cornerwedge/truss/mesh all render as a box placeholder in v1.
      return new THREE.BoxGeometry(sx, sy, sz);
  }
}

const textureCache = new Map();
const textureLoader = new THREE.TextureLoader();

function loadAssetTexture(id) {
  if (!Number.isInteger(id)) return Promise.resolve(null);
  if (!textureCache.has(id)) {
    textureCache.set(id, new Promise((resolve) => {
      textureLoader.load(`/asset/${id}`, resolve, undefined, () => resolve(null));
    }));
  }
  return textureCache.get(id);
}

function assetColor(value, fallback = [255, 255, 255]) {
  return Array.isArray(value) && value.length === 3 ? value : fallback;
}

function assetVector(value, fallback) {
  return Array.isArray(value) && value.length === fallback.length ? value : fallback;
}

function assetNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function surfaceMapTarget(asset) {
  const mapName = String(asset.map || "color").replace(/[\s_-]/g, "").toLowerCase();
  return ({
    color: "map",
    colormap: "map",
    albedo: "map",
    diffuse: "map",
    normal: "normalMap",
    normalmap: "normalMap",
    roughness: "roughnessMap",
    roughnessmap: "roughnessMap",
    metalness: "metalnessMap",
    metalnessmap: "metalnessMap",
    metallic: "metalnessMap",
    emissive: "emissiveMap",
    emissivemask: "emissiveMap",
    emissivemaskcontent: "emissiveMap",
  })[mapName];
}

// ---- procedural material detail ------------------------------------------------
// Roblox's built-in materials (Wood, LeafyGrass, Slate...) are engine-internal — they have
// no asset id to fetch through /asset/:id, so the mirror rendered every surface as flat
// plastic while Studio showed grain and mottle. Synthesise a grayscale detail map per
// material family instead: three.js multiplies `map` by `color`, which is exactly how
// Roblox modulates a material by a part's Color, so a ~white-mean texture keeps the hue
// and only adds surface relief.
const materialTextureCache = new Map();

function texRng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function drawMaterialDetail(hint, data, size) {
  const rand = texRng(hashString(hint));
  const put = (x, y, v) => {
    const i = (y * size + x) << 2;
    const c = Math.max(0, Math.min(255, v));
    data[i] = data[i + 1] = data[i + 2] = c;
    data[i + 3] = 255;
  };
  const fine = (base, amp) => {
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) put(x, y, base + (rand() - 0.5) * amp);
  };

  if (hint === "wood" || hint === "wood-planks") {
    // grain: banded rings running along one axis, with jitter so it isn't a barcode
    for (let y = 0; y < size; y += 1) {
      const band = Math.sin(y * 0.55 + Math.sin(y * 0.13) * 2.2) * 10;
      for (let x = 0; x < size; x += 1) put(x, y, 232 + band + (rand() - 0.5) * 9);
    }
    if (hint === "wood-planks") {
      for (let y = 0; y < size; y += 32) for (let x = 0; x < size; x += 1) { put(x, y, 196); put(x, (y + 1) % size, 208); }
    }
    return;
  }
  if (hint === "grass" || hint === "leafy-grass") {
    // clumped foliage: soft dark blobs over a light base reads as leaf mass at distance
    fine(236, 16);
    const clumps = hint === "leafy-grass" ? 90 : 60;
    for (let i = 0; i < clumps; i += 1) {
      const cx = Math.floor(rand() * size), cy = Math.floor(rand() * size);
      const r = 3 + rand() * 6, dark = 26 + rand() * 26;
      for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) {
        const d = Math.hypot(x, y);
        if (d > r) continue;
        const px = (cx + x + size) % size, py = (cy + y + size) % size;
        const i2 = (py * size + px) << 2;
        put(px, py, data[i2] - dark * (1 - d / r));
      }
    }
    return;
  }
  if (hint === "brick" || hint === "cobblestone") {
    const rows = 8, cols = 4;
    const rh = size / rows, cw = size / cols;
    fine(234, 12);
    for (let y = 0; y < size; y += 1) {
      const row = Math.floor(y / rh);
      const offset = (row % 2) * (cw / 2);
      for (let x = 0; x < size; x += 1) {
        const onRow = y % rh < 1.5;
        const onCol = (x + offset) % cw < 1.5;
        if (onRow || onCol) put(x, y, 186);
      }
    }
    return;
  }
  if (hint === "fabric") {
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const weave = ((x >> 1) + (y >> 1)) % 2 ? 8 : -8;
      put(x, y, 230 + weave + (rand() - 0.5) * 6);
    }
    return;
  }
  if (hint === "metal" || hint === "foil" || hint === "diamond-plate") {
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) put(x, y, 242 + Math.sin(x * 0.9) * 4 + (rand() - 0.5) * 5);
    return;
  }
  if (hint === "sand" || hint === "snow") { fine(240, 14); return; }
  if (hint === "ice" || hint === "glass" || hint === "neon") { fine(248, 5); return; }
  // rock / concrete / slate / basalt / asphalt / pavement / granite / marble / mud / ground
  fine(230, 30);
}

function materialTexture(hint) {
  if (!hint || typeof document === "undefined") return null;
  if (materialTextureCache.has(hint)) return materialTextureCache.get(hint);
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  drawMaterialDetail(hint, image.data, size);
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  materialTextureCache.set(hint, texture);
  return texture;
}

// Tile roughly every 4 studs so texel density stays constant instead of stretching a
// single tile over a whole wall.
function applyMaterialDetail(material, part, profile) {
  const base = materialTexture(profile.textureHint);
  if (!base) return;
  const size = Array.isArray(part.size) ? part.size : [4, 4, 4];
  const span = Math.max(1, Math.min(12, Math.max(size[0], size[1], size[2]) / 4));
  const map = base.clone();
  map.needsUpdate = true;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(span, span);
  material.map = map;
  material.bumpMap = map;
  material.bumpScale = profile.textureHint === "wood" ? 0.22 : 0.12;
}

function materialForPart(part) {
  const materialValue = part.material ?? part.Material ?? "Plastic";
  const materialName = typeof materialValue === "object" ? materialValue.Name : materialValue;
  const materialKey = String(materialName).replace(/[\s_-]/g, "").toLowerCase();
  const profile = ROBLOX_MATERIALS[materialKey] || ROBLOX_MATERIALS.plastic;
  const transparency = clampNumber(part.transparency ?? part.Transparency, 0, 1, 0);
  const opacity = 1 - transparency;
  const reflectance = clampNumber(part.reflectance ?? part.Reflectance, 0, 1, 0);
  const assets = Array.isArray(part.assets) ? part.assets : [];
  const surface = assets.find((asset) => asset?.kind === "SurfaceAppearance");
  const usePartColorValue = part.usePartColor ?? part.UsePartColor;
  const usePartColor = typeof usePartColorValue === "boolean" ? usePartColorValue : true;
  const colorValue = usePartColor
    ? part.sourceColor ?? part.SourceColor ?? part.color ?? part.Color
    : part.unionColor ?? part.UnionColor ?? part.color ?? part.Color;
  const color = surface?.color || colorValue || [255, 255, 255];
  const emissiveTint = assetColor(surface?.emissiveTint, [0, 0, 0]);
  const alphaMode = String(surface?.alphaMode || "");
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color((color[0] ?? 255) / 255, (color[1] ?? 255) / 255, (color[2] ?? 255) / 255),
    roughness: profile.roughness,
    metalness: Math.max(profile.metalness, reflectance),
    emissive: new THREE.Color(emissiveTint[0] / 255, emissiveTint[1] / 255, emissiveTint[2] / 255),
    emissiveIntensity: assetNumber(surface?.emissiveStrength, 0),
    transparent: opacity < 1 || alphaMode === "Transparency",
    opacity,
    alphaTest: alphaMode === "Transparency" ? 0.01 : 0,
  });
  material.reflectivity = reflectance;
  material.userData.reflectance = reflectance;
  material.userData.usePartColor = usePartColor;
  const materialVariant = part.materialVariant ?? part.MaterialVariant;
  if (materialVariant !== undefined && materialVariant !== null && materialVariant !== "") {
    material.userData.materialVariant = String(materialVariant);
  }
  if (profile.textureHint) material.userData.textureHint = profile.textureHint;
  // Synthesised built-in-material detail. Runs BEFORE the asset loop below so a real
  // SurfaceAppearance/Texture always wins over the approximation.
  applyMaterialDetail(material, part, profile);
  for (const asset of assets) {
    if (!asset || !["SurfaceAppearance", "MeshPartTexture"].includes(asset.kind)) continue;
    const target = asset.kind === "MeshPartTexture" ? "map" : surfaceMapTarget(asset);
    if (!target) continue;
    loadAssetTexture(asset.id).then((texture) => {
      if (!texture) return;
      const map = texture.clone();
      if (target === "map" || target === "emissiveMap") map.colorSpace = THREE.SRGBColorSpace;
      material[target] = map;
      material.needsUpdate = true;
    });
  }
  return material;
}

function faceSpec(face, size) {
  const [sx, sy, sz] = size;
  switch (String(face || "Front").toLowerCase()) {
    case "right": return { width: sz, height: sy, position: [sx / 2 + 0.002, 0, 0], rotation: [0, Math.PI / 2, 0] };
    case "left": return { width: sz, height: sy, position: [-sx / 2 - 0.002, 0, 0], rotation: [0, -Math.PI / 2, 0] };
    case "top": return { width: sx, height: sz, position: [0, sy / 2 + 0.002, 0], rotation: [-Math.PI / 2, 0, 0] };
    case "bottom": return { width: sx, height: sz, position: [0, -sy / 2 - 0.002, 0], rotation: [Math.PI / 2, 0, 0] };
    case "back": return { width: sx, height: sy, position: [0, 0, -sz / 2 - 0.002], rotation: [0, Math.PI, 0] };
    default: return { width: sx, height: sy, position: [0, 0, sz / 2 + 0.002], rotation: [0, 0, 0] };
  }
}

function configureSurfaceTexture(texture, asset, spec) {
  if (asset.kind === "Texture") {
    const u = Math.max(0.001, assetNumber(asset.studsPerTileU, 2));
    const v = Math.max(0.001, assetNumber(asset.studsPerTileV, 2));
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(Math.max(0.001, spec.width / u), Math.max(0.001, spec.height / v));
    texture.offset.set(assetNumber(asset.offsetStudsU, 0) / u, assetNumber(asset.offsetStudsV, 0) / v);
  } else {
    const scale = assetVector(asset.uvScale, [1, 1]);
    const offset = assetVector(asset.uvOffset, [0, 0]);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(assetNumber(scale[0], 1), assetNumber(scale[1], 1));
    texture.offset.set(assetNumber(offset[0], 0), assetNumber(offset[1], 0));
    texture.center.set(0.5, 0.5);
    texture.rotation = THREE.MathUtils.degToRad(assetNumber(asset.rotation, 0));
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function addFaceAsset(mesh, part, asset) {
  const spec = faceSpec(asset.face, part.size);
  const partOpacity = 1 - clampNumber(part.transparency ?? part.Transparency, 0, 1, 0);
  const assetOpacity = 1 - clampNumber(asset.transparency, 0, 1, 0);
  const color = assetColor(asset.color);
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255),
    transparent: partOpacity * assetOpacity < 1,
    opacity: partOpacity * assetOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
   });
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height), material);
  overlay.position.set(...spec.position);
  overlay.rotation.set(...spec.rotation);
  overlay.renderOrder = (asset.kind === "Decal" ? 20 : 10) + assetNumber(asset.zIndex, 0) / 1000;
  overlay.userData.buildkitAsset = true;
  mesh.add(overlay);
  loadAssetTexture(asset.id).then((texture) => {
    if (!texture || !overlay.parent) return;
    material.map = configureSurfaceTexture(texture.clone(), asset, spec);
    material.needsUpdate = true;
  });
  return overlay;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

// Common Roblox materials. textureHint is metadata only; asset fetching belongs
// to the server proxy, so this browser helper stays deterministic and offline.
const ROBLOX_MATERIALS = {
  plastic: { roughness: 0.55, metalness: 0 },
  smoothplastic: { roughness: 0.38, metalness: 0 },
  neon: { roughness: 0.25, metalness: 0, textureHint: "neon" },
  metal: { roughness: 0.28, metalness: 0.85, textureHint: "metal" },
  corrodedmetal: { roughness: 0.78, metalness: 0.65, textureHint: "corroded-metal" },
  diamondplate: { roughness: 0.42, metalness: 0.85, textureHint: "diamond-plate" },
  foil: { roughness: 0.2, metalness: 0.9, textureHint: "foil" },
  wood: { roughness: 0.78, metalness: 0, textureHint: "wood" },
  woodplanks: { roughness: 0.82, metalness: 0, textureHint: "wood-planks" },
  concrete: { roughness: 0.92, metalness: 0, textureHint: "concrete" },
  brick: { roughness: 0.88, metalness: 0, textureHint: "brick" },
  granite: { roughness: 0.72, metalness: 0, textureHint: "granite" },
  marble: { roughness: 0.34, metalness: 0, textureHint: "marble" },
  slate: { roughness: 0.9, metalness: 0, textureHint: "slate" },
  basalt: { roughness: 0.86, metalness: 0, textureHint: "basalt" },
  rock: { roughness: 0.95, metalness: 0, textureHint: "rock" },
  sand: { roughness: 0.96, metalness: 0, textureHint: "sand" },
  grass: { roughness: 0.9, metalness: 0, textureHint: "grass" },
  ice: { roughness: 0.22, metalness: 0, textureHint: "ice" },
  snow: { roughness: 0.92, metalness: 0, textureHint: "snow" },
  glass: { roughness: 0.08, metalness: 0, textureHint: "glass" },
  fabric: { roughness: 0.98, metalness: 0, textureHint: "fabric" },
  asphalt: { roughness: 0.95, metalness: 0, textureHint: "asphalt" },
  pavement: { roughness: 0.9, metalness: 0, textureHint: "pavement" },
  cobblestone: { roughness: 0.9, metalness: 0, textureHint: "cobblestone" },
};

// Builds one real-geometry mesh for a part {shape,pos,size,rot,color,transparency}.
// pos/rot here are Roblox-space (see robloxToThree* above); color is a 0-255 [r,g,b].
export function meshForPart(part) {
  const geo = geometryFor(part.shape, part.size);
  const mesh = new THREE.Mesh(geo, materialForPart(part));
  mesh.position.copy(robloxToThreePos(part.pos));
  mesh.setRotationFromEuler(robloxToThreeEuler(part.rot));
  const castShadow = part.castShadow ?? part.CastShadow;
  mesh.castShadow = castShadow === undefined ? true : Boolean(castShadow);
  for (const key of ["path", "parentPath", "name", "opIndex", "partIndex", "locked"]) {
    if (part[key] !== undefined) mesh.userData[key] = part[key];
  }
  for (const asset of Array.isArray(part.assets) ? part.assets : []) {
    if (asset?.kind === "Texture" || asset?.kind === "Decal") addFaceAsset(mesh, part, asset);
  }
  markIfOperation(mesh, part, geo);
  return mesh;
}

// A CSG operation (Union/Intersect/Negate) is dumped as its BOUNDING BOX — the plugin
// cannot read the real solid back out of Studio. Rendering that box opaque made a union
// swallow everything inside and behind it (an 8-stud trunk union hid an entire canopy).
// Draw it translucent with visible edges instead: honest that it is an approximation, and
// it stops occluding. depthWrite:false keeps it from sorting over parts behind it.
const OPERATION_SHAPES = new Set(["union", "intersect", "negate"]);
// Detect from `class` FIRST: the dump has carried the real ClassName all along, so this
// works on existing scene.json with no Studio restart. `shape` only reports the operation
// after the plugin rebuild lands, so relying on it alone left the bug visible.
export function isOperationPart(part) {
  const cls = String(part?.class || "");
  if (/^(Union|Intersect|Negate|Part)Operation$/.test(cls)) return true;
  return OPERATION_SHAPES.has(String(part?.shape || "").toLowerCase());
}
function markIfOperation(mesh, part, geo) {
  if (!isOperationPart(part)) return;
  mesh.userData.operation = String(part.class || part.shape || "operation").toLowerCase();
  const m = mesh.material;
  m.transparent = true;
  m.opacity = Math.min(m.opacity ?? 1, 0.3);
  m.depthWrite = false;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.6 })
  );
  edges.userData.decorative = true;
  mesh.add(edges);
}

// Rebuild the TRUE solid for a dumped CSG operation from the source parts buildProp
// stashed on it (BuildKitCsgParts). Without this a union only has its bounding box, which
// renders as an occluding slab. Returns null on any failure so callers fall back to the
// translucent-box treatment rather than losing the object entirely.
// NOTE: spec `rot` is DEGREES (BUILD_SPEC), while dumped `rot` is RADIANS — convert.
function csgSourceOp(p) {
  return p.op || (p.negate ? "subtract" : "union");
}
export function csgMeshFromDump(part) {
  let source;
  try {
    source = JSON.parse(part.csgPartsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(source) || source.length === 0) return null;

  const buckets = { union: [], subtract: [], intersect: [] };
  for (const p of source) (buckets[csgSourceOp(p)] || buckets.union).push(p);
  if (buckets.union.length === 0) return null;

  // Sources are stored as WORLD-space entries with radian rot (same shape and the same
  // single rotation convention as any dumped part), so they go straight through
  // meshForPart with no re-centring, rescaling or degree conversion.
  const brushFor = (p) => {
    const mesh = meshForPart({
      shape: p.shape || "box",
      size: p.size || [1, 1, 1],
      pos: p.pos || [0, 0, 0],
      rot: p.rot || [0, 0, 0],
      color: p.color || part.color || [150, 150, 150],
      material: p.material ?? part.material,
      transparency: p.transparency,
    });
    const brush = new Brush(mesh.geometry, mesh.material);
    brush.position.copy(mesh.position);
    brush.quaternion.copy(mesh.quaternion);
    brush.updateMatrixWorld(true);
    return brush;
  };

  try {
    const evaluator = new Evaluator();
    let result = brushFor(buckets.union[0]);
    const apply = (p, operation) => {
      const next = evaluator.evaluate(result, brushFor(p), operation);
      result.geometry.dispose();
      result = next;
    };
    for (const p of buckets.union.slice(1)) apply(p, ADDITION);
    for (const p of buckets.subtract) apply(p, SUBTRACTION);
    for (const p of buckets.intersect) apply(p, INTERSECTION);
    result.name = part.name || "CsgOperation";
    result.userData.rebuiltCsg = true;
    for (const key of ["path", "parentPath", "name", "opIndex", "partIndex"]) {
      if (part[key] !== undefined) result.userData[key] = part[key];
    }
    return result;
  } catch {
    return null;
  }
}

export function addPart(group, part) {
  // Prefer the rebuilt boolean; fall back to meshForPart (which draws operations
  // translucent so they cannot hide what is behind them).
  const mesh = (part.csgPartsJson && csgMeshFromDump(part)) || meshForPart(part);
  group.add(mesh);
  return mesh;
}

const MIRROR_INSTANCE_SHAPES = new Set(["box", "block", "ball", "cylinder"]);
const MIRROR_INSTANCE_CLASSES = new Set(["Part", "Seat", "VehicleSeat", "SpawnLocation"]);

function finiteVec3(value, fallback) {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => Number.isFinite(Number(entry)))
    ? value.map(Number)
    : fallback;
}

function mirrorMaterialColor(part) {
  const usePartColorValue = part.usePartColor ?? part.UsePartColor;
  const usePartColor = typeof usePartColorValue === "boolean" ? usePartColorValue : true;
  const value = usePartColor
    ? part.sourceColor ?? part.SourceColor ?? part.color ?? part.Color
    : part.unionColor ?? part.UnionColor ?? part.color ?? part.Color;
  return assetColor(value).map((entry) => assetNumber(entry, 255));
}

function mirrorInstanceKey(part) {
  const material = part.material ?? part.Material ?? "Plastic";
  const materialName = typeof material === "object" ? material.Name : material;
  const size = finiteVec3(part.size, [1, 1, 1]);
  const transparency = clampNumber(part.transparency ?? part.Transparency, 0, 1, 0);
  const reflectance = clampNumber(part.reflectance ?? part.Reflectance, 0, 1, 0);
  const castShadow = part.castShadow ?? part.CastShadow;
  return JSON.stringify([
    String(part.shape || "box").toLowerCase(),
    size,
    String(materialName),
    mirrorMaterialColor(part),
    transparency,
    reflectance,
    String(part.materialVariant ?? part.MaterialVariant ?? ""),
    castShadow === undefined ? true : Boolean(castShadow),
    part.usePartColor ?? part.UsePartColor ?? null,
  ]);
}

function mirrorInstanceCompatible(part) {
  if (!part || typeof part !== "object" || Array.isArray(part)) return false;
  if (isOperationPart(part) || part.csgPartsJson !== undefined || part.csgParts !== undefined || part.op || part.negate) return false;
  if (part.placeholder || part.isPlaceholder || part.operation) return false;
  if (part.meshId !== undefined || part.MeshId !== undefined) return false;
  if (Array.isArray(part.assets) && part.assets.length) return false;
  const shape = String(part.shape || "box").toLowerCase();
  if (!MIRROR_INSTANCE_SHAPES.has(shape)) return false;
  if (part.class && !MIRROR_INSTANCE_CLASSES.has(String(part.class))) return false;
  const size = finiteVec3(part.size, null);
  const pos = finiteVec3(part.pos, null);
  if (!size || !pos || size.some((entry) => entry <= 0)) return false;
  if (clampNumber(part.transparency ?? part.Transparency, 0, 1, 0) !== 0) return false;
  return true;
}

function copyMirrorSelectionData(proxy, part, index) {
  for (const key of ["path", "fullPath", "parentPath", "name", "class", "locked"]) {
    if (part[key] !== undefined) proxy.userData[key] = part[key];
  }
  proxy.userData.selection = { opIndex: index, partIndex: -1 };
  proxy.userData.locked = Boolean(part.locked);
  proxy.userData.instancedProxy = true;
}

// ponytail: only opaque, asset-free BaseParts with one visual tuple are batched;
// CSG/assets/transparency stay as ordinary meshes until per-instance overlays are safe.
export function addMirrorParts(group, parts) {
  const batches = new Map();
  const ordinary = [];
  for (let index = 0; index < parts.length; index += 1) {
    const raw = parts[index] || {};
    const part = {
      ...raw,
      pos: finiteVec3(raw.pos, [0, 0, 0]),
      rot: finiteVec3(raw.rot, [0, 0, 0]),
      size: finiteVec3(raw.size, [1, 1, 1]),
    };
    if (!mirrorInstanceCompatible(part)) {
      ordinary.push({ index, part });
      continue;
    }
    const key = mirrorInstanceKey(part);
    let batch = batches.get(key);
    if (!batch) {
      batch = { part, records: [] };
      batches.set(key, batch);
    }
    batch.records.push({ index, part });
  }

  for (const { index, part } of ordinary) {
    const mesh = addPart(group, part);
    mesh.name = part.name || part.class || `Part ${index + 1}`;
    for (const key of ["path", "fullPath", "parentPath", "name", "class", "locked"]) {
      if (part[key] !== undefined) mesh.userData[key] = part[key];
    }
    mesh.userData.selection = { opIndex: index, partIndex: -1 };
  }

  const identity = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4();
  for (const batch of batches.values()) {
    const first = batch.part;
    const geometry = geometryFor(first.shape, first.size);
    const material = materialForPart(first);
    const visible = new THREE.InstancedMesh(geometry, material, batch.records.length);
    visible.name = `MirrorBatch:${first.shape || "box"}`;
    visible.castShadow = Boolean(first.castShadow ?? first.CastShadow ?? true);
    visible.userData.instanced = true;
    visible.userData.instanceRecords = [];
    batch.records.forEach(({ index, part }, instanceId) => {
      const position = robloxToThreePos(part.pos);
      const quaternion = new THREE.Quaternion().setFromEuler(robloxToThreeEuler(part.rot));
      matrix.compose(position, quaternion, identity);
      visible.setMatrixAt(instanceId, matrix);

      const proxy = new THREE.Mesh(geometry, material);
      proxy.position.copy(position);
      proxy.quaternion.copy(quaternion);
      proxy.visible = false;
      copyMirrorSelectionData(proxy, part, index);
      proxy.userData.instancedSource = visible;
      proxy.userData.instancedInstanceId = instanceId;
      visible.userData.instanceRecords[instanceId] = { proxy, index };
      group.add(proxy);
    });
    visible.instanceMatrix.needsUpdate = true;
    visible.computeBoundingBox();
    visible.computeBoundingSphere();
    group.add(visible);
  }
}

export function selectionTargetForHit(hit) {
  const object = hit?.object;
  if (!object) return null;
  const records = object.userData?.instanceRecords;
  if (records) return Number.isInteger(hit.instanceId) ? records[hit.instanceId]?.proxy || null : null;
  return object;
}

// Bbox wireframe for build ops whose fine geometry only exists in the Luau builders
// (cabinet/chair/bed/...) — shows scale/layout without claiming fidelity. `label` is
// set as the mesh name (visible via console/inspector) rather than an in-scene overlay.
export function addPlaceholder(group, center, size, label) {
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffaa33, wireframe: true }));
  wire.position.copy(robloxToThreePos(center));
  if (label) wire.name = label;
  group.add(wire);
  return wire;
}

// Standard scene/camera/renderer/controls rig shared by both pages.
export async function initScene() {
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1b1f);
  // Roblox's default outdoor lighting is a bright blue sky dome with warm sun and a
  // grey-lilac ground bounce — a flat white ambient made every surface read as dead
  // plastic and washed the material detail out. Hemisphere + warm key matches far closer.
  scene.add(new THREE.HemisphereLight(0xa9c9ff, 0x6a6a78, 1.05));
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.15);
  sun.position.set(40, 80, 30);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.28);
  fill.position.set(-50, 30, -40);
  scene.add(fill);
  scene.add(new THREE.GridHelper(200, 40, 0x444455, 0x2a2a30));

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);
  camera.position.set(30, 25, 30);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 5, 0);
  controls.mouseButtons.LEFT = null;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  (function tick() {
    requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  })();

  return { scene, camera, renderer, controls };
}
