/**
 * Portable assembly sockets for library presets.
 *
 * Socket positions are studs in the assembly root's local frame. Socket
 * rotations are degrees in the same XYZ convention as build-spec `rot` and
 * Roblox `CFrame.Angles`. Roblox and the viewer use a right-handed, Y-up
 * frame; forward is -Z.
 */

/** Examples used in docs; socket names are intentionally not closed to this list. */
export const SOCKET_NAME_EXAMPLES = [
  "road_end",
  "doorway",
  "foundation",
  "roof_mount",
] as const;

/** Compatibility alias for early consumers; this is documentation only, not an enum. */
export const SOCKET_NAMES = SOCKET_NAME_EXAMPLES;

export const SOCKET_NAME_MAX_LENGTH = 64;
export type SocketName = string;
export type Vec3 = [number, number, number];

export type AssemblySocket = {
  name: SocketName;
  pos: Vec3;
  rot: Vec3;
};

/** Compatibility alias for callers that use the term socket definition. */
export type SocketDefinition = AssemblySocket;

/** A world/root transform, expressed with the viewer-facing field names. */
export type SocketTransform = {
  position: Vec3;
  rotation: Vec3;
};

export type SocketAlignmentOptions = {
  /** Current world transform of the assembly carrying `source`; identity by default. */
  sourceRoot?: SocketTransform;
  /** Current world transform of the assembly carrying `target`; identity by default. */
  targetRoot?: SocketTransform;
  /** Turn the source socket 180 degrees around target-local Y before aligning. */
  opposite?: boolean;
};

export type SocketResidual = {
  /** World-space distance between the aligned source and target socket positions, in studs. */
  position: number;
  /** Angular distance between the aligned source and requested target socket frames, in degrees. */
  orientation: number;
};

export type SocketAlignment = {
  /** Translation component of a world-space transform pre-multiplied onto sourceRoot. */
  translation: Vec3;
  /** XYZ degrees of the world-space rotation pre-multiplied onto sourceRoot. */
  rotation: Vec3;
  /** Final world transform for the source assembly after alignment. */
  root: SocketTransform;
  residual: SocketResidual;
};

const DEGREES = Math.PI / 180;
const RADIANS = 180 / Math.PI;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteVec3(value: unknown, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error(`${field} must be [x,y,z] finite numbers`);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

export function validateSocket(value: unknown, label = "socket"): AssemblySocket {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) throw new Error(`${label}.name must be a non-empty string`);
  if (name.length > SOCKET_NAME_MAX_LENGTH) {
    throw new Error(`${label}.name must be at most ${SOCKET_NAME_MAX_LENGTH} characters`);
  }
  if ([...name].some((character) => character < " " || character === "\u007f")) {
    throw new Error(`${label}.name must not contain control characters`);
  }
  return {
    name,
    pos: finiteVec3(value.pos, `${label}.pos`),
    rot: finiteVec3(value.rot, `${label}.rot`),
  };
}

export function validateSockets(value: unknown): AssemblySocket[] {
  if (!Array.isArray(value)) throw new Error("library sockets must be an array");
  const names = new Set<SocketName>();
  return value.map((item, index) => {
    const socket = validateSocket(item, `library sockets[${index}]`);
    if (names.has(socket.name)) throw new Error(`duplicate library socket name: ${socket.name}`);
    names.add(socket.name);
    return socket;
  });
}

type Quaternion = [number, number, number, number];

function normalizeQuaternion(value: Quaternion): Quaternion {
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  if (!Number.isFinite(length) || length === 0) return [0, 0, 0, 1];
  return [value[0] / length, value[1] / length, value[2] / length, value[3] / length];
}

function multiplyQuaternion(a: Quaternion, b: Quaternion): Quaternion {
  return normalizeQuaternion([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]);
}

function inverseQuaternion(value: Quaternion): Quaternion {
  const lengthSquared = value[0] ** 2 + value[1] ** 2 + value[2] ** 2 + value[3] ** 2;
  if (!Number.isFinite(lengthSquared) || lengthSquared === 0) return [0, 0, 0, 1];
  return [-value[0] / lengthSquared, -value[1] / lengthSquared, -value[2] / lengthSquared, value[3] / lengthSquared];
}

function rotateVector(rotation: Quaternion, value: Vec3): Vec3 {
  const [x, y, z, w] = rotation;
  const tx = 2 * (y * value[2] - z * value[1]);
  const ty = 2 * (z * value[0] - x * value[2]);
  const tz = 2 * (x * value[1] - y * value[0]);
  return [
    value[0] + w * tx + y * tz - z * ty,
    value[1] + w * ty + z * tx - x * tz,
    value[2] + w * tz + x * ty - y * tx,
  ];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function quaternionFromEulerXYZ(rotation: Vec3): Quaternion {
  const x = rotation[0] * DEGREES / 2;
  const y = rotation[1] * DEGREES / 2;
  const z = rotation[2] * DEGREES / 2;
  const sx = Math.sin(x), cx = Math.cos(x);
  const sy = Math.sin(y), cy = Math.cos(y);
  const sz = Math.sin(z), cz = Math.cos(z);
  return normalizeQuaternion([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ]);
}

function eulerXYZFromQuaternion(value: Quaternion): Vec3 {
  const [x, y, z, w] = normalizeQuaternion(value);
  // These are the XYZ matrix entries used by Three.Euler.setFromRotationMatrix:
  // m13 = te[8], m32 = te[6], and m22 = te[5] for Three's column-major array.
  const m13 = Math.max(-1, Math.min(1, 2 * (x * z + y * w)));
  const rotationY = Math.asin(m13);
  let rotationX: number;
  let rotationZ: number;
  if (Math.abs(m13) < 0.9999999) {
    rotationX = Math.atan2(2 * (w * x - y * z), 1 - 2 * (x * x + y * y));
    rotationZ = Math.atan2(2 * (w * z - x * y), 1 - 2 * (y * y + z * z));
  } else {
    // At gimbal lock X and Z are not separately recoverable. Three's XYZ
    // convention chooses Z=0 and recovers the combined X angle from m32/m22.
    const m32 = 2 * (y * z + x * w);
    const m22 = 1 - 2 * (x * x + z * z);
    rotationX = Math.atan2(m32, m22);
    rotationZ = 0;
  }
  return [rotationX * RADIANS, rotationY * RADIANS, rotationZ * RADIANS];
}

function quaternionAngleDegrees(a: Quaternion, b: Quaternion): number {
  const left = normalizeQuaternion(a);
  const right = normalizeQuaternion(b);
  const dot = Math.max(-1, Math.min(1, Math.abs(left[0] * right[0] + left[1] * right[1] + left[2] * right[2] + left[3] * right[3])));
  return 2 * Math.acos(dot) * RADIANS;
}

function normalizeTransform(value: unknown, label: string): SocketTransform {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return {
    position: finiteVec3(value.position, `${label}.position`),
    rotation: finiteVec3(value.rotation, `${label}.rotation`),
  };
}

function identityTransform(): SocketTransform {
  return { position: [0, 0, 0], rotation: [0, 0, 0] };
}

type WorldSocket = { position: Vec3; rotation: Quaternion };

function worldSocket(root: SocketTransform, socket: AssemblySocket): WorldSocket {
  const rootRotation = quaternionFromEulerXYZ(root.rotation);
  return {
    position: add(root.position, rotateVector(rootRotation, socket.pos)),
    rotation: multiplyQuaternion(rootRotation, quaternionFromEulerXYZ(socket.rot)),
  };
}

/**
 * Return a transform that places `source` on `target`.
 *
 * `translation` and `rotation` form a world-space transform to pre-multiply
 * onto the current source root (the same composition as `worldCF * pivot` in
 * the Studio plugin). `opposite:true` is useful when both socket frames point
 * out of their assemblies: it preserves Y/up and reverses the target-local
 * forward/right axes with a 180-degree Y turn. The default is exact frame
 * alignment because it makes the orientation rule explicit at each call site.
 */
export function alignSockets(
  source: AssemblySocket,
  target: AssemblySocket,
  options: SocketAlignmentOptions = {},
): SocketAlignment {
  const sourceSocket = validateSocket(source, "source socket");
  const targetSocket = validateSocket(target, "target socket");
  const sourceRoot = options.sourceRoot === undefined ? identityTransform() : normalizeTransform(options.sourceRoot, "sourceRoot");
  const targetRoot = options.targetRoot === undefined ? identityTransform() : normalizeTransform(options.targetRoot, "targetRoot");
  const targetWorld = worldSocket(targetRoot, targetSocket);
  const targetAdjustment = options.opposite === true ? quaternionFromEulerXYZ([0, 180, 0]) : [0, 0, 0, 1] as Quaternion;
  const desiredSocketRotation = multiplyQuaternion(targetWorld.rotation, targetAdjustment);
  const sourceLocalRotation = quaternionFromEulerXYZ(sourceSocket.rot);
  const finalRootRotation = multiplyQuaternion(desiredSocketRotation, inverseQuaternion(sourceLocalRotation));
  const finalRootPosition = subtract(targetWorld.position, rotateVector(finalRootRotation, sourceSocket.pos));
  const finalRoot = {
    position: finalRootPosition,
    rotation: eulerXYZFromQuaternion(finalRootRotation),
  } satisfies SocketTransform;

  const sourceRootRotation = quaternionFromEulerXYZ(sourceRoot.rotation);
  const deltaRotation = multiplyQuaternion(finalRootRotation, inverseQuaternion(sourceRootRotation));
  const translation = subtract(finalRootPosition, rotateVector(deltaRotation, sourceRoot.position));
  const alignedSource = worldSocket(finalRoot, sourceSocket);
  return {
    translation,
    rotation: eulerXYZFromQuaternion(deltaRotation),
    root: finalRoot,
    residual: {
      position: distance(alignedSource.position, targetWorld.position),
      orientation: quaternionAngleDegrees(alignedSource.rotation, desiredSocketRotation),
    },
  };
}
