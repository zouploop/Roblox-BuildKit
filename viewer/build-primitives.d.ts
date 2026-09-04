export type XYZ = [number, number, number];
export interface AuthoredConnection {
  id: string;
  type: "touch" | "supportedBy" | "continuousSurface" | "clearance";
  a: { part: string; point: XYZ };
  b: { part: string; point: XYZ };
  tolerance?: number;
  min?: number;
  max?: number;
}
export interface PartStyle {
  /** Stable ID/name prefix. Supply a unique name for each helper call in a prop. */
  name?: string;
  color?: XYZ;
  material?: string;
}
export interface RawPart extends PartStyle {
  id: string;
  name: string;
  shape: "box" | "cylinder";
  pos: XYZ;
  size: XYZ;
  /** XYZ degrees, as used by CFrame.Angles. */
  rot: XYZ;
}
/** End-face centers exactly match endpoints; cylinder length is local X. */
export function beamBetween(args: PartStyle & {
  from: XYZ; to: XYZ; width: number; shape?: "box" | "cylinder";
}): RawPart;
/** Points are post feet. Includes top/mid rails; max 3D post spacing defaults to 4. */
export function railingPath(args: PartStyle & {
  points: XYZ[]; height?: number; width?: number; postSpacing?: number;
  /** Optional output array; joints append only after successful generation. */
  connections?: AuthoredConnection[];
}): RawPart[];
/** Solid, contiguous deck with endpoint landings. Endpoints are surface edge centers.
 * Foundation bottom is min(endpoint Y)-thickness; supply support at that elevation.
 * Throws when run cannot fit landings/treads. Guardrails default on. */
export function bridgeBetween(args: PartStyle & {
  from: XYZ; to: XYZ; width: number;
  stepRise?: number; minTread?: number; landingLength?: number; thickness?: number;
  guardrails?: boolean; railHeight?: number; railWidth?: number; postSpacing?: number;
  /** Optional output array for deck, rail and post-support joints. */
  connections?: AuthoredConnection[];
}): RawPart[];
