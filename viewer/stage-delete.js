export function deletePatchesForSelection(ops, selectedRefs) {
  const selections = new Map();

  for (const ref of selectedRefs ?? []) {
    if (!Number.isInteger(ref?.opIndex) || !Number.isInteger(ref?.partIndex)) continue;
    if (!ops?.[ref.opIndex]) continue;

    let selection = selections.get(ref.opIndex);
    if (!selection) {
      selection = { whole: false, parts: new Set() };
      selections.set(ref.opIndex, selection);
    }
    if (ref.partIndex < 0) selection.whole = true;
    else selection.parts.add(ref.partIndex);
  }

  const patches = [];
  for (const [index, selection] of selections) {
    const args = ops[index]?.args;
    const parts = args?.kind === "prop" && Array.isArray(args.parts) ? args.parts : null;
    const allPartsSelected = parts && parts.every((_, partIndex) => selection.parts.has(partIndex));
    if (selection.whole || !parts || allPartsSelected) {
      patches.push({ index, patch: { remove: true } });
      continue;
    }
    for (const partIndex of [...selection.parts].sort((a, b) => b - a)) {
      if (partIndex < parts.length) patches.push({ index, partIndex, patch: { remove: true } });
    }
  }
  return patches;
}
