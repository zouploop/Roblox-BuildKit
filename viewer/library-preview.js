// Camera math shared by the library thumbnail renderer and its focused tests.
export function previewCameraFit(radius, aspect, fovDeg = 38, padding = 1.18) {
  const safeRadius = Math.max(0.01, Number(radius) || 0.01);
  const safeAspect = Math.max(0.1, Number(aspect) || 1);
  const safeFov = Math.min(120, Math.max(1, Number(fovDeg) || 38));
  const safePadding = Math.max(1, Number(padding) || 1);
  const verticalFov = (safeFov * Math.PI) / 180;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
  const limitingHalfFov = Math.min(verticalFov, horizontalFov) / 2;
  const distance = (safeRadius / Math.sin(limitingHalfFov)) * safePadding;
  return {
    distance,
    near: Math.max(0.01, distance - safeRadius * 2.5),
    far: Math.max(100, distance + safeRadius * 2.5),
  };
}

export function previewPlacementDelta(bounds, target) {
  return [
    target[0] - (bounds.minX + bounds.maxX) / 2,
    target[1] - bounds.minY,
    target[2] - (bounds.minZ + bounds.maxZ) / 2,
  ];
}
