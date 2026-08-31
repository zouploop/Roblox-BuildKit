export function lockPatchesForSelection(ops, refs) {
  const targets = [];
  const seen = new Set();
  for (const ref of refs) {
    const index = Number(ref?.opIndex);
    const partIndex = Number(ref?.partIndex ?? -1);
    const op = ops[index];
    if (partIndex < 0 && op?.args?.kind === "prop" && Array.isArray(op.args.parts)) {
      op.args.parts.forEach((target, childIndex) => {
        const key = `${index}:${childIndex}`;
        if (!target || seen.has(key)) return;
        seen.add(key);
        targets.push({ index, partIndex: childIndex, target });
      });
      continue;
    }
    const target = partIndex >= 0 ? op?.args?.parts?.[partIndex] : op?.args;
    const key = `${index}:${partIndex}`;
    if (!target || seen.has(key)) continue;
    seen.add(key);
    targets.push({ index, partIndex, target, op });
  }
  const locked = targets.some(({ target }) => target.locked !== true);
  return targets.map(({ index, partIndex, target, op }) => ({
    index,
    patch: partIndex >= 0 ? { ...target, locked } : { ...op, args: { ...target, locked } },
    ...(partIndex >= 0 ? { partIndex } : {}),
  }));
}
