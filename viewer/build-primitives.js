// Dependency-free raw prop parts. rot is XYZ degrees (CFrame.Angles), not dump YXZ.
const EPS = 1e-8;
const LIMIT = 4096;
const degrees = 180 / Math.PI;

function vector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every(Number.isFinite)) {
    throw new Error(`${label} must be a finite XYZ triple`);
  }
  return value;
}

function positive(value, label) {
  if (!Number.isFinite(value) || value <= EPS) throw new Error(`${label} must be positive and finite`);
  return value;
}

function style({ name, color, material }, fallback) {
  name ??= fallback;
  if (typeof name !== "string" || !name.trim()) throw new Error("name must be nonempty");
  if (color !== undefined && vector(color, "color").some(v => v < 0 || v > 255)) throw new Error("color must be RGB 0..255");
  if (material !== undefined && (typeof material !== "string" || !material.trim())) throw new Error("material must be nonempty");
  return { name, ...(color === undefined ? {} : { color: [...color] }), ...(material === undefined ? {} : { material }) };
}

function part(settings, suffix, pos, size, rot = [0, 0, 0], shape = "box") {
  const name = suffix ? `${settings.name}/${suffix}` : settings.name;
  vector(pos, "part position");
  size.forEach(v => positive(v, "part size"));
  return { ...settings, id: name, name, shape, pos, size, rot };
}

function connectionTarget(connections) {
  if (connections !== undefined && !Array.isArray(connections)) throw new Error("connections must be an array");
}

function joint(id, type, a, ap, b, bp) {
  return { id, type, a: { part: a.id, point: ap }, b: { part: b.id, point: bp }, tolerance: 1e-6 };
}

/** End-face centers are exactly from/to. Both shapes use local X as length. */
export function beamBetween({ from, to, width, shape = "box", ...options }) {
  vector(from, "from"); vector(to, "to"); positive(width, "width");
  if (shape !== "box" && shape !== "cylinder") throw new Error("shape must be box or cylinder");
  const d = to.map((v, i) => v - from[i]);
  const length = positive(Math.hypot(...d), "beam length");
  const yaw = Math.atan2(-d[2], d[0]);
  const pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
  // Frame Ry(yaw) * Rz(pitch), decomposed into Rx * Ry * Rz.
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const rot = Math.abs(cy) > EPS
    ? [Math.atan2(0, cy), Math.asin(Math.max(-1, Math.min(1, sy))), Math.atan2(cy * Math.sin(pitch), cy * Math.cos(pitch))]
    : [Math.atan2(sy * Math.sin(pitch), Math.cos(pitch)), Math.sign(sy) * Math.PI / 2, 0];
  return part(style(options, "beam"), "", from.map((v, i) => v / 2 + to[i] / 2), [length, width, width], rot.map(v => v * degrees), shape);
}

/** points are post-foot/rail-base positions; spacing is maximum 3D segment spacing. */
export function railingPath({ points, height = 3, width = 0.15, postSpacing = 4, connections, ...options }) {
  connectionTarget(connections);
  if (!Array.isArray(points) || points.length < 2) throw new Error("points needs at least two XYZ triples");
  points.forEach(p => vector(p, "point"));
  positive(height, "height"); positive(width, "width"); positive(postSpacing, "postSpacing");
  if (height <= width) throw new Error("height must exceed rail width");
  const settings = style(options, "railing"), parts = [], seen = new Map(), joints = [];
  function post(p) {
    const key = JSON.stringify(p);
    if (seen.has(key)) return seen.get(key);
    const result = beamBetween({ ...settings, name: `${settings.name}/post-${seen.size}`, from: p, to: [p[0], p[1] + height, p[2]], width });
    seen.set(key, result);
    parts.push(result);
    return result;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = positive(Math.hypot(...b.map((v, j) => v - a[j])), "path segment");
    const count = Math.ceil(length / postSpacing);
    if (parts.length + count + 3 > LIMIT) throw new Error("railing exceeds 4096 parts");
    for (let k = 0; k <= count; k++) post(k === count ? b : a.map((v, j) => v + (b[j] - v) * k / count));
    for (const [label, lift] of [["top", height], ["mid", height / 2]]) {
      const rail = beamBetween({ ...settings, name: `${settings.name}/${label}-${i - 1}`, from: [a[0], a[1] + lift, a[2]], to: [b[0], b[1] + lift, b[2]], width });
      parts.push(rail);
      if (connections) {
        joints.push(joint(`${rail.id}/from`, "touch", rail, [-rail.size[0] / 2, 0, 0], post(a), [lift - height / 2, 0, 0]));
        joints.push(joint(`${rail.id}/to`, "touch", rail, [rail.size[0] / 2, 0, 0], post(b), [lift - height / 2, 0, 0]));
      }
    }
  }
  if (connections) connections.push(...joints);
  return parts;
}

/** Endpoints are walking-surface centers at the outer landing edges. Solid foundations
 * meet at min(endpoint Y)-thickness; caller supplies terrain/abutment support there.
 * No floating treads, overlapping full-span floor, or inferred ground elevation. */
export function bridgeBetween({ from, to, width, stepRise = 0.5, minTread = 0.75,
  landingLength = width, thickness = 0.5, guardrails = true, railHeight = 3,
  railWidth = 0.15, postSpacing = 4, connections, ...options }) {
  connectionTarget(connections);
  vector(from, "from"); vector(to, "to");
  for (const [label, value] of Object.entries({ width, stepRise, minTread, landingLength, thickness, railHeight, railWidth, postSpacing })) positive(value, label);
  if (typeof guardrails !== "boolean") throw new Error("guardrails must be boolean");
  if (guardrails && (width <= 2 * railWidth || railHeight <= railWidth)) throw new Error("guardrails do not fit width/height");
  const run = positive(Math.hypot(to[0] - from[0], to[2] - from[2]), "horizontal run");
  const rise = to[1] - from[1];
  if (!Number.isFinite(rise)) throw new Error("rise must be finite");
  const steps = Math.ceil(Math.abs(rise) / stepRise);
  if (steps + 1 > LIMIT) throw new Error("bridge exceeds 4096 deck sections");
  if (steps && (run < 2 * landingLength || (steps > 1 && (run - 2 * landingLength) / (steps - 1) < minTread))) {
    throw new Error("horizontal run cannot fit landings and minimum treads");
  }
  const settings = style(options, "bridge");
  const ux = (to[0] - from[0]) / run, uz = (to[2] - from[2]) / run;
  const rot = [0, Math.atan2(-uz, ux) * degrees, 0];
  const bottom = Math.min(from[1], to[1]) - thickness;
  const at = (s, y, side = 0) => [from[0] + ux * s - uz * side, y, from[2] + uz * s + ux * side];
  const cells = [];
  for (let i = 0; i <= steps; i++) {
    const start = !steps || i === 0 ? 0 : steps === 1 ? run / 2 : landingLength + (i - 1) * (run - 2 * landingLength) / (steps - 1);
    const end = i === steps ? run : steps === 1 ? run / 2 : landingLength + i * (run - 2 * landingLength) / (steps - 1);
    const top = i === steps ? to[1] : from[1] + rise * i / steps;
    cells.push({ start, end, top });
  }
  const parts = cells.map(({ start, end, top }, i) => part(settings, `deck-${i}`, at((start + end) / 2, (top + bottom) / 2), [end - start, top - bottom, width], [...rot]));
  const joints = [];
  if (connections) for (let i = 1; i < cells.length; i++) {
    const a = parts[i - 1], b = parts[i], y = Math.min(cells[i - 1].top, cells[i].top);
    joints.push(joint(`${settings.name}/deck-joint-${i - 1}`, "touch", a, [a.size[0] / 2, y - a.pos[1], 0], b, [-b.size[0] / 2, y - b.pos[1], 0]));
  }
  if (guardrails) {
    for (const side of [-1, 1]) {
      const offset = side * (width - railWidth) / 2;
      // At a riser, seat the shared post on the higher tread. Infill posts follow
      // each horizontal tread; rails connect their tops across each elevation change.
      const feet = [], supports = [];
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i], count = Math.ceil((cell.end - cell.start) / postSpacing);
        if (feet.length + count + 1 > LIMIT / 6) throw new Error("bridge guardrails exceed part budget");
        for (let k = 0; k < count; k++) {
          const support = k === 0 && i && cells[i - 1].top > cell.top ? i - 1 : i;
          const distance = cell.start + (cell.end - cell.start) * k / count;
          feet.push(at(distance, cells[support].top, offset));
          supports.push({ index: support, distance });
        }
      }
      feet.push(at(run, to[1], offset));
      supports.push({ index: cells.length - 1, distance: run });
      // Already spaced on the deck: do not interpolate additional floating feet.
      const rails = railingPath({ ...settings, name: `${settings.name}/rail-${side < 0 ? "left" : "right"}`, points: feet, height: railHeight, width: railWidth, postSpacing: Number.MAX_VALUE, ...(connections ? { connections: joints } : {}) });
      if (connections) rails.filter(p => /\/post-\d+$/.test(p.name)).forEach((post, i) => {
        const { index, distance } = supports[i], deck = parts[index];
        joints.push(joint(`${post.id}/support`, "supportedBy", post, [-post.size[0] / 2, 0, 0], deck,
          [distance - (cells[index].start + cells[index].end) / 2, deck.size[1] / 2, offset]));
      });
      parts.push(...rails);
    }
  }
  if (parts.length > LIMIT) throw new Error("bridge exceeds 4096 parts");
  if (connections) connections.push(...joints);
  return parts;
}
