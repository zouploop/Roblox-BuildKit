---
name: roblox-extreme-quality
description: Reference-driven iterative building for when quality matters more than speed. Look at references ONCE, convert them to a written checkable spec, build, verify against the spec, and iterate with checkpoints — instead of one-shotting and hoping. Use when the user says "extreme quality", "make this really good", "high quality", "take your time on this", "make it look real/accurate", or asks for a hero asset. EXPENSIVE — warn the user and get confirmation before starting. Roblox-focused (uses rbx_* tooling) but the method generalises to any visual build.
---

# Extreme Quality

A method, not a feature. Slower and more expensive than a normal build, and it produces
noticeably better objects — but only if the loop is run properly. Run it badly and it costs
several times as much for the same result.

## The one rule

**Look at references ONCE. Convert them to a written spec. Then iterate against the spec,
never against the images.**

```
references ──(once)──► SPEC (countable, checkable)
                          │
              build ──► verify vs SPEC ──► revise ──► repeat
```

### Why — this is not an optimisation, it's the thing that makes it work

Holistic visual judgement ("does this look right?") is the least reliable thing a model
does. Real failure from this codebase: a tree was rendered, inspected, and called good while
its branches were geometrically wrong the entire time — the error was obvious in the numbers
and invisible to the eye-check. An iteration loop built on vibes confidently converges on
the wrong object.

Checkable criteria don't have that failure mode. *"Trunk is ~1/3 of total height"* and
*"5–7 primary limbs"* are either true or false, and `rbx_map` answers both without a render.

It is also far cheaper. **Images persist in context and are re-sent every turn** — five
iterations × three images ≈ 22k tokens, paid again on every subsequent turn. A spec is ~200
tokens, read once. Cheaper *and* more reliable is rare; take it.

## Before starting: warn and confirm

State plainly: this uses substantially more tokens than a normal build, give the estimated
iteration count (default cap 4), and ask whether to proceed. Do not start the loop on an
ambiguous "make it nice".

---

## Phase 1 — References

Get 2–4 references. In order of preference: user-provided > web search > generated.

Look at each **once**. Do not re-open them later in the loop — everything needed must be in
the spec by the end of this phase. If you find yourself wanting to re-check an image, that
means the spec is missing a criterion: add the criterion instead.

**References are for study, not shipping.** Don't reproduce a specific copyrighted design;
extract what makes the *class* of object read correctly.

## Phase 2 — The spec (load-bearing; do this properly)

Write to `specs/<object>-spec.md`. Every line must be checkable by counting, measuring, or
looking at a silhouette. If a line can't be checked, it isn't a criterion — cut it.

```markdown
# <object> — build spec

## Style target
<e.g. "Roblox-readable oak: chunky, reads as an oak at 20 studs. NOT photoreal.">

## Proportions        (ratios, never absolute studs — they must survive rescaling)
- trunk height ≈ 0.35 × total height
- canopy width ≈ 1.2 × canopy height
- trunk base diameter ≈ 2.5 × top diameter (visible taper)

## Part inventory     (countable via rbx_map)
- 1 trunk, 5–7 stacked segments, tapering
- 5–7 primary limbs, attached above 40% height
- 6+ root flares at the base

## Silhouette landmarks   (must be visible in a FLAT/isolated render)
- root flare bulges wider than the trunk
- canopy overhangs the trunk on every side
- gaps between canopy clusters — not one solid blob

## Colour roles
- bark: mid-brown, darker in crevices
- foliage: 3+ distinct greens, lighter toward the top

## Anti-features      (the known ways this object goes wrong)
- "lollipop": one sphere on a stick
- uniform canopy: a single flat green
- branches radiating at one height like a wheel
```

**Anti-features matter as much as features.** They are the failure modes for this object
class, and they're easier to detect than judging quality in the abstract.

## Phase 3 — Build

Build normally (see `roblox-building` — generator file → stage → port). Nothing special
here; the method is in what surrounds it.

**Checkpoint first.** `rbx_checkpoint` before every iteration. That is what makes "undo if it
got worse" possible — restoring a checkpoint is far more reliable than walking an undo stack.

## Phase 4 — Verify against the spec

Cheapest checks first. Most defects are caught before spending a single image.

| Check | How | Catches |
|---|---|---|
| Part inventory | `rbx_map` counts | missing/extra structure |
| Proportions | `rbx_map` bounds arithmetic | wrong ratios — the most common real defect |
| Silhouette | `rbx_view` `isolate` + `contrast` | lollipop, blob, bad massing |
| All sides | `rbx_view` `angles:4` | "great from the front, broken from behind" |
| Anti-features | the silhouette render | the known failure modes |
| Structural QA | `rbx_qa` (region-scoped) | real overlaps, z-fights, floating parts, unjoined assemblies |

**Two things about the tools this phase leans on:**

- **`rbx_qa` is rotation-AWARE (verified 2026-08-30)** — `worldAABB` projects each part's true
  oriented box and gates against real geometry via `GetPartsInPart`. Its overlap/z-fight hits
  are REAL. Older notes calling it "rotation-blind" are stale; acting on them means dismissing
  genuine defects.
- **`rbx_qa`'s `region` param was briefly regressed (a stale in-memory Studio plugin ignored
  it) and is now fixed + live-verified 2026-08-31** — a radius-3 region and a whole-workspace
  scan return genuinely different `parts` counts. Region-scope it after each map chunk:
  `rbx_qa({fit:true, region:{center:[...],radius:...}})`. Use `abut:true` for straight
  line/grid tiling and inspect the placement response's adjacent `gaps` before moving to the
  next chunk.
- **`rbx_map`'s `region` has a separate, different bug**: it's applied AFTER the 800-part cap,
  not before, so a populated region past the 800th part comes back empty. Don't read a `rbx_map`
  "0 parts" as "nothing there" — narrow `target` too, or cross-check with `rbx_view`.

Write the result as a **pass/fail line per criterion**, not prose:

```
PASS trunk ≈ 0.35H (measured 0.33)
FAIL 5-7 primary limbs (found 3)
PASS root flare visible
FAIL canopy has gaps (reads as one blob)
```

**Never soften a FAIL.** The whole method depends on the check being honest — a generous
self-assessment here is worse than not running the loop at all.

## Phase 5 — Iterate

Fix **only the FAIL lines.** Do not "improve" passing criteria; that's how iterations churn
without converging.

After each pass, re-verify and compare scores:
- **Improved** → checkpoint again, continue
- **Worse** → restore the checkpoint, try a different fix (not the same fix harder)
- **Unchanged** → see termination

## Termination — stop rules, all mandatory

Stop when **any** of these is true, and report the final scorecard:

1. All criteria pass.
2. **Iteration cap reached** (default 4). Say what still fails.
3. **No criterion flipped this pass.** Two passes with no change means the approach can't
   fix it — stop and say what's blocking, rather than burning the budget.
4. Score got worse twice in a row — restore the best checkpoint and stop.

A loop without stop rules is the main way this mode wastes money.

## Cost discipline

- References: **once**, then never again. Work from the spec.
- Prefer numbers over pictures — `rbx_map` costs ~100 tokens, a render ~1.5k *and* persists.
- Render small for checks; full resolution only for the final look.
- One silhouette + one 4-angle sheet per iteration. Not more.

## Style target vs accuracy target

A photo reference copied faithfully often looks **wrong** in Roblox. The engine has its own
visual language: chunky proportions, silhouettes that read at distance, a limited material
vocabulary, no fine surface detail.

So the spec always carries a style line. "Realistic oak" and "Roblox oak that reads as an
oak" are different builds, and the second is almost always what's wanted.

## When NOT to use this

- Blocking-out, greyboxing, layout tests — quality isn't the constraint yet
- Background/filler props seen at distance
- Anything the user wants quickly
- Objects with no real-world referent (abstract, fantasy, purely stylised) — there's no
  ground truth to extract a spec from, so the loop has nothing to check against

## See also

- `roblox-building` — the actual build loop, QA rules, proportion standards
- Silhouette-first judging and raw-pixel verification are general lessons; they apply here
  and are why Phase 4 leads with the isolated render rather than a lit one.
