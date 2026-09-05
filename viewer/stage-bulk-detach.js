export function generatorNamesForSelection(selectedRefs, ownerForOp) {
  const names = [];
  const seen = new Set();
  for (const ref of selectedRefs ?? []) {
    const name = ownerForOp?.(ref?.opIndex);
    if (typeof name !== "string" || !name.trim() || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function detachRequestForNames(names) {
  const unique = [];
  const seen = new Set();
  for (const name of names ?? []) {
    if (typeof name !== "string" || !name.trim() || seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  if (!unique.length) return null;
  return unique.length === 1 ? { name: unique[0] } : { names: unique };
}
