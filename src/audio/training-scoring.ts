import {
  trainingCoverage,
  trainingFingerprint,
  validateTrainingManifest,
  type FrameRange,
  type TrainingManifest,
} from "./training-contract";

export const TRAINING_SCORING_VERSION = "source-onset-v1";
export const MATCH_TOLERANCE_MS = 20;
const MAX_EVENTS = 20000;
const MAX_ASSOCIATIONS = 1000000;
export interface OnsetMatch {
  desiredFrame: number;
  detectedFrame: number;
  errorMs: number;
}
export interface OnsetScore {
  matches: OnsetMatch[];
  missingFrames: number[];
  extraFrames: number[];
  matched: number;
  missing: number;
  extra: number;
  meanAbsoluteMs: number | null;
  biasMs: number | null;
}
interface Chain {
  count: number;
  error: number;
  desired: number;
  detected: number;
  previous: Chain | null;
  order: number;
}
const better = (a: Chain | null, b: Chain | null) =>
  !a
    ? b
    : !b
      ? a
      : a.count !== b.count
        ? a.count > b.count
          ? a
          : b
        : a.error !== b.error
          ? a.error < b.error
            ? a
            : b
          : a.order < b.order
            ? a
            : b;
function events(input: readonly number[], limit = Number.MAX_SAFE_INTEGER): number[] {
  if (input.length > MAX_EVENTS || input.some((n) => !Number.isFinite(n) || n < 0 || n >= limit))
    throw new Error("Invalid or excessive onset frames");
  return [...input].sort((a, b) => a - b);
}
/** Sparse monotone matching: maximum cardinality, then minimum absolute frame error. */
export function matchTrainingOnsets(
  desiredFrames: readonly number[],
  detectedFrames: readonly number[],
  sampleRate: number,
): OnsetScore {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new Error("Invalid sample rate");
  if (desiredFrames.some((n) => !Number.isSafeInteger(n)))
    throw new Error("Desired frames must be integers");
  const desired = events(desiredFrames),
    detected = events(detectedFrames),
    tolerance = (sampleRate * MATCH_TOLERANCE_MS) / 1000;
  if (new Set(desired).size !== desired.length) throw new Error("Duplicate desired attack");
  const tree: (Chain | null)[] = Array(detected.length + 1).fill(null);
  const query = (end: number) => {
    let result: Chain | null = null;
    for (let i = end; i > 0; i -= i & -i) result = better(result, tree[i]);
    return result;
  };
  const update = (at: number, value: Chain) => {
    for (let i = at + 1; i < tree.length; i += i & -i) tree[i] = better(tree[i], value);
  };
  let left = 0,
    right = 0,
    associations = 0,
    order = 0;
  for (let i = 0; i < desired.length; i++) {
    while (left < detected.length && detected[left] < desired[i] - tolerance) left++;
    right = Math.max(left, right);
    while (right < detected.length && detected[right] <= desired[i] + tolerance) right++;
    const pending: Chain[] = [];
    for (let j = left; j < right; j++) {
      if (++associations > MAX_ASSOCIATIONS)
        throw new Error("Onset association limit exceeded; reduce scored material");
      const previous = query(j);
      pending.push({
        count: (previous?.count ?? 0) + 1,
        error: (previous?.error ?? 0) + Math.abs(desired[i] - detected[j]),
        desired: i,
        detected: j,
        previous,
        order: order++,
      });
    }
    // Delay updates so one desired event cannot be used twice in the same row.
    for (const node of pending) update(node.detected, node);
  }
  const matchedDesired = new Set<number>(),
    matchedDetected = new Set<number>(),
    matches: OnsetMatch[] = [];
  for (let node = query(detected.length); node; node = node.previous) {
    matchedDesired.add(node.desired);
    matchedDetected.add(node.detected);
    matches.push({
      desiredFrame: desired[node.desired],
      detectedFrame: detected[node.detected],
      errorMs: ((detected[node.detected] - desired[node.desired]) * 1000) / sampleRate,
    });
  }
  matches.reverse();
  const missingFrames = desired.filter((_, i) => !matchedDesired.has(i)),
    extraFrames = detected.filter((_, i) => !matchedDetected.has(i));
  return {
    matches,
    missingFrames,
    extraFrames,
    matched: matches.length,
    missing: missingFrames.length,
    extra: extraFrames.length,
    meanAbsoluteMs: matches.length
      ? matches.reduce((n, m) => n + Math.abs(m.errorMs), 0) / matches.length
      : null,
    biasMs: matches.length ? matches.reduce((n, m) => n + m.errorMs, 0) / matches.length : null,
  };
}
export function unionFrameRanges(ranges: readonly FrameRange[]): FrameRange[] {
  const sorted = ranges
      .map((r) => ({ ...r }))
      .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame),
    out: FrameRange[] = [];
  for (const r of sorted) {
    if (
      !Number.isSafeInteger(r.startFrame) ||
      !Number.isSafeInteger(r.endFrame) ||
      r.startFrame < 0 ||
      r.endFrame <= r.startFrame
    )
      throw new Error("Invalid evaluation range");
    const last = out.at(-1);
    if (last && r.startFrame <= last.endFrame) last.endFrame = Math.max(last.endFrame, r.endFrame);
    else out.push(r);
  }
  return out;
}
function intersection(a: readonly FrameRange[], b: readonly FrameRange[]) {
  const out: FrameRange[] = [];
  for (const x of a)
    for (const y of b) {
      const startFrame = Math.max(x.startFrame, y.startFrame),
        endFrame = Math.min(x.endFrame, y.endFrame);
      if (endFrame > startFrame) out.push({ startFrame, endFrame });
    }
  return unionFrameRanges(out);
}
function subtract(ranges: readonly FrameRange[], excluded: readonly FrameRange[]) {
  let result = ranges.map((r) => ({ ...r }));
  for (const mask of unionFrameRanges(excluded)) {
    const next: FrameRange[] = [];
    for (const r of result) {
      if (mask.endFrame <= r.startFrame || mask.startFrame >= r.endFrame) {
        next.push(r);
        continue;
      }
      if (mask.startFrame > r.startFrame)
        next.push({ startFrame: r.startFrame, endFrame: mask.startFrame });
      if (mask.endFrame < r.endFrame)
        next.push({ startFrame: mask.endFrame, endFrame: r.endFrame });
    }
    result = next;
  }
  return result;
}
const inside = (frame: number, ranges: readonly FrameRange[]) =>
  ranges.some((r) => frame >= r.startFrame && frame < r.endFrame);
const frames = (ranges: readonly FrameRange[]) =>
  ranges.reduce((n, r) => n + r.endFrame - r.startFrame, 0);
export interface AnalysisCoverage {
  sourceChecksum: string;
  configuration: string;
  reliableFromFrame: number;
  processedThroughFrame: number;
}
export interface SourceEvaluationPlan {
  checksum: string;
  groupId: string;
  sampleRate: number;
  sourceFrames: number;
  desiredFrames: number[];
  evaluated: FrameRange[];
  excluded: {
    uncertainty: FrameRange[];
    startup: FrameRange[];
    terminal: FrameRange[];
    missingContext: FrameRange[];
    overlap: FrameRange[];
  };
}
export interface TrainingEvaluationPlan {
  fingerprint: string;
  version: typeof TRAINING_SCORING_VERSION;
  configurations: string[];
  sources: SourceEvaluationPlan[];
  assignments: Record<string, "training" | "withheld" | "unassigned">;
}
function sourceLineages(manifest: TrainingManifest) {
  const byChecksum = new Map(manifest.sources.map((s) => [s.checksum, s]));
  function ancestry(checksum: string) {
    let root = checksum,
      offset = 0,
      depth = 0;
    const visited = new Set<string>();
    while (true) {
      if (visited.has(root)) throw new Error("Cyclic source ancestry");
      visited.add(root);
      const s = byChecksum.get(root);
      if (!s?.provenance.ancestorChecksum) break;
      offset += s.provenance.ancestorStartFrame!;
      if (!Number.isSafeInteger(offset)) throw new Error("Invalid ancestor offset");
      const ancestor = byChecksum.get(s.provenance.ancestorChecksum);
      if (ancestor && ancestor.sampleRate !== s.sampleRate)
        throw new Error("Related source rates require explicit mapping");
      root = s.provenance.ancestorChecksum;
      depth++;
    }
    return { root, offset, depth };
  }
  const lineages = new Map(
    manifest.sources.map((source) => [source.checksum, ancestry(source.checksum)]),
  );
  const roots = new Map<string, { group: string; rate: number }>();
  for (const source of manifest.sources) {
    const lineage = lineages.get(source.checksum)!;
    if (!Number.isSafeInteger(lineage.offset + source.frames))
      throw new Error("Ancestor extent exceeds safe frame coordinates");
    const group = manifest.groups.find((group) =>
      group.sourceChecksums.includes(source.checksum),
    )!.id;
    const prior = roots.get(lineage.root);
    if (prior && prior.group !== group)
      throw new Error(
        "Related recordings must share one group, even when the ancestor audio is absent",
      );
    if (prior && prior.rate !== source.sampleRate)
      throw new Error("Related source rates require explicit mapping");
    roots.set(lineage.root, { group, rate: source.sampleRate });
  }
  return lineages;
}
function freezePlan<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezePlan(item);
    Object.freeze(value);
  }
  return value;
}

/** Build once from ALL compared configurations before ranking any candidate. */
export async function createTrainingEvaluationPlan(
  input: TrainingManifest,
  configurations: readonly string[],
  coverage: readonly AnalysisCoverage[],
): Promise<TrainingEvaluationPlan> {
  const manifest = validateTrainingManifest(input);
  const lineages = sourceLineages(manifest);
  if (
    !configurations.length ||
    new Set(configurations).size !== configurations.length ||
    configurations.some((x) => !x)
  )
    throw new Error("Declare unique comparison configurations");
  const assignment = Object.fromEntries(manifest.groups.map((g) => [g.id, g.assignment]));
  const seen = new Set<string>();
  for (const c of coverage) {
    const key = JSON.stringify([c.sourceChecksum, c.configuration]);
    if (seen.has(key)) throw new Error("Duplicate analysis coverage");
    seen.add(key);
    if (
      !configurations.includes(c.configuration) ||
      !manifest.sources.some((s) => s.checksum === c.sourceChecksum)
    )
      throw new Error("Unknown analysis coverage");
  }
  const plans: SourceEvaluationPlan[] = [];
  for (const s of manifest.sources) {
    const examples = manifest.examples.filter(
      (e) => e.sourceChecksum === s.checksum && e.reviewed && trainingCoverage(e, s).complete,
    );
    if (!examples.length) continue;
    const available = unionFrameRanges(examples.map((e) => e.bar)),
      desired = [...new Set(examples.flatMap((e) => e.desiredFrames))].sort((a, b) => a - b);
    if (desired.length > MAX_EVENTS)
      throw new Error("Too many desired attacks in a source evaluation");
    const labelSets = new Map(examples.map((e) => [e.id, new Set(e.desiredFrames)]));
    // Two fully reviewed overlapping bars may not disagree about an attack's existence.
    for (const d of desired)
      for (const e of examples)
        if (
          d >= e.bar.startFrame &&
          d < e.bar.endFrame &&
          !inside(d, e.uncertain) &&
          !labelSets.get(e.id)!.has(d)
        )
          throw new Error("Conflicting overlapping annotations");
    const bounds = configurations.map((configuration) => {
      const c = coverage.find(
        (c) => c.sourceChecksum === s.checksum && c.configuration === configuration,
      );
      if (
        !c ||
        ![c.reliableFromFrame, c.processedThroughFrame].every(Number.isSafeInteger) ||
        c.reliableFromFrame < 0 ||
        c.processedThroughFrame < c.reliableFromFrame ||
        c.processedThroughFrame > s.frames
      )
        throw new Error("Missing or invalid common analysis coverage");
      return c;
    });
    const reliable = Math.max(...bounds.map((c) => c.reliableFromFrame)),
      through = Math.min(...bounds.map((c) => c.processedThroughFrame));
    if (through < reliable)
      throw new Error("Compared configurations have no common analysis window");
    const margin = Math.ceil(s.sampleRate * 0.02);
    const uncertainty = intersection(
      available,
      unionFrameRanges(
        examples.flatMap((e) =>
          e.uncertain.map((r) => ({
            startFrame: Math.max(0, r.startFrame - margin),
            endFrame: Math.min(s.frames, r.endFrame + margin),
          })),
        ),
      ),
    );
    const startup =
      reliable > 0 ? intersection(available, [{ startFrame: 0, endFrame: reliable }]) : [];
    const terminal =
      through < s.frames
        ? intersection(available, [{ startFrame: through, endFrame: s.frames }])
        : [];
    // Cropped prehistory cannot be certified representative by inventing a warmup duration.
    const missingContext = s.provenance.beginningAvailable ? [] : available;
    const evaluated = subtract(available, [
      ...uncertainty,
      ...startup,
      ...terminal,
      ...missingContext,
    ]);
    const group = manifest.groups.find((g) => g.sourceChecksums.includes(s.checksum))!;
    plans.push({
      checksum: s.checksum,
      groupId: group.id,
      sampleRate: s.sampleRate,
      sourceFrames: s.frames,
      desiredFrames: desired,
      evaluated,
      excluded: { uncertainty, startup, terminal, missingContext, overlap: [] },
    });
  }
  // Known excerpts share a root timeline; prefer the source with most original context.
  const ordered = plans
    .map((p) => ({ p, ...lineages.get(p.checksum)! }))
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        b.p.sourceFrames - a.p.sourceFrames ||
        (a.p.checksum < b.p.checksum ? -1 : 1),
    );
  const used = new Map<string, { sampleRate: number; ranges: FrameRange[] }>();
  for (const { p, root, offset } of ordered) {
    const key = JSON.stringify([p.groupId, root]),
      prior = used.get(key);
    if (prior && prior.sampleRate !== p.sampleRate)
      throw new Error("Related source rates require explicit mapping");
    const global = p.evaluated.map((r) => ({
      startFrame: r.startFrame + offset,
      endFrame: r.endFrame + offset,
    }));
    const retained = subtract(global, prior?.ranges ?? []);
    p.excluded.overlap = subtract(
      p.evaluated,
      retained.map((r) => ({ startFrame: r.startFrame - offset, endFrame: r.endFrame - offset })),
    );
    p.evaluated = retained.map((r) => ({
      startFrame: r.startFrame - offset,
      endFrame: r.endFrame - offset,
    }));
    used.set(key, {
      sampleRate: p.sampleRate,
      ranges: unionFrameRanges([...(prior?.ranges ?? []), ...retained]),
    });
  }
  plans.sort((a, b) => (a.checksum < b.checksum ? -1 : 1));
  const policy = {
    version: TRAINING_SCORING_VERSION as typeof TRAINING_SCORING_VERSION,
    configurations: [...configurations].sort(),
    sources: plans,
    assignments: Object.fromEntries(
      Object.entries(assignment).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    inputFingerprint: await trainingFingerprint(manifest),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(policy));
  const fingerprint = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  return freezePlan({
    fingerprint,
    version: policy.version,
    configurations: policy.configurations,
    sources: plans,
    assignments: policy.assignments,
  });
}
export interface SourceScore extends OnsetScore {
  checksum: string;
  groupId: string;
  evaluatedSeconds: number;
  excludedSeconds: number;
  excludedDesired: number;
  excludedDetections: number;
}
export interface RecordingScore {
  groupId: string;
  matched: number;
  missing: number;
  extra: number;
  evaluatedSeconds: number;
  errorsPerSecond: number;
  meanAbsoluteMs: number | null;
  biasMs: number | null;
}
export interface DatasetScore {
  comparisonFingerprint: string;
  version: string;
  sources: SourceScore[];
  recordings: RecordingScore[];
  errorsPerSecond: number | null;
  meanAbsoluteMs: number | null;
  biasMs: number | null;
  assignment: "training" | "withheld";
  evidence: "unavailable" | "training-only" | "preliminary" | "withheld";
  missingTimingGroups: number;
}
export function evaluateTrainingOnsets(
  plan: TrainingEvaluationPlan,
  configuration: string,
  onsets: Readonly<Record<string, readonly number[]>>,
  assignment: "training" | "withheld",
): DatasetScore {
  if (plan.version !== TRAINING_SCORING_VERSION || !plan.configurations.includes(configuration))
    throw new Error("Unknown scoring version or configuration");
  const sources: SourceScore[] = [];
  for (const p of plan.sources) {
    if (plan.assignments[p.groupId] !== assignment) continue;
    if (!Object.hasOwn(onsets, p.checksum))
      throw new Error("Missing detector results (empty must be explicit)");
    const detected = events(onsets[p.checksum], p.sourceFrames),
      desired = p.desiredFrames.filter((d) => inside(d, p.evaluated)),
      actual = detected.filter((d) => inside(d, p.evaluated));
    // Match each contiguous evaluated interval independently: never bridge an excluded region.
    const parts = p.evaluated.map((r) =>
      matchTrainingOnsets(
        desired.filter((d) => inside(d, [r])),
        actual.filter((d) => inside(d, [r])),
        p.sampleRate,
      ),
    );
    const matches = parts.flatMap((x) => x.matches),
      missingFrames = parts.flatMap((x) => x.missingFrames),
      extraFrames = parts.flatMap((x) => x.extraFrames);
    const excluded = unionFrameRanges(Object.values(p.excluded).flat());
    sources.push({
      checksum: p.checksum,
      groupId: p.groupId,
      matches,
      missingFrames,
      extraFrames,
      matched: matches.length,
      missing: missingFrames.length,
      extra: extraFrames.length,
      meanAbsoluteMs: matches.length
        ? matches.reduce((n, m) => n + Math.abs(m.errorMs), 0) / matches.length
        : null,
      biasMs: matches.length ? matches.reduce((n, m) => n + m.errorMs, 0) / matches.length : null,
      evaluatedSeconds: frames(p.evaluated) / p.sampleRate,
      excludedSeconds: frames(excluded) / p.sampleRate,
      excludedDesired: p.desiredFrames.filter((d) => inside(d, excluded)).length,
      excludedDetections: detected.filter((d) => inside(d, excluded)).length,
    });
  }
  const recordings: RecordingScore[] = [];
  for (const groupId of [...new Set(sources.map((s) => s.groupId))].sort()) {
    const group = sources.filter((s) => s.groupId === groupId),
      duration = group.reduce((n, s) => n + s.evaluatedSeconds, 0);
    if (!duration) continue;
    const matches = group.flatMap((s) => s.matches),
      missing = group.reduce((n, s) => n + s.missing, 0),
      extra = group.reduce((n, s) => n + s.extra, 0);
    recordings.push({
      groupId,
      matched: matches.length,
      missing,
      extra,
      evaluatedSeconds: duration,
      errorsPerSecond: (missing + extra) / duration,
      meanAbsoluteMs: matches.length
        ? matches.reduce((n, m) => n + Math.abs(m.errorMs), 0) / matches.length
        : null,
      biasMs: matches.length ? matches.reduce((n, m) => n + m.errorMs, 0) / matches.length : null,
    });
  }
  const eligibleGroups = new Set(
    plan.sources
      .filter((s) => s.evaluated.length && plan.assignments[s.groupId] !== "unassigned")
      .map((s) => s.groupId),
  );
  const hasTraining = plan.sources.some(
    (s) => s.evaluated.length && plan.assignments[s.groupId] === "training",
  );
  const hasWithheld = plan.sources.some(
    (s) => s.evaluated.length && plan.assignments[s.groupId] === "withheld",
  );
  const timing = recordings.filter((r) => r.meanAbsoluteMs !== null);
  return {
    comparisonFingerprint: plan.fingerprint,
    version: plan.version,
    sources,
    recordings,
    assignment,
    evidence:
      !recordings.length || !hasTraining
        ? "unavailable"
        : !hasWithheld || eligibleGroups.size < 2
          ? "training-only"
          : eligibleGroups.size < 5
            ? "preliminary"
            : "withheld",
    errorsPerSecond: recordings.length
      ? recordings.reduce((n, r) => n + r.errorsPerSecond, 0) / recordings.length
      : null,
    meanAbsoluteMs: timing.length
      ? timing.reduce((n, r) => n + r.meanAbsoluteMs!, 0) / timing.length
      : null,
    biasMs: timing.length ? timing.reduce((n, r) => n + r.biasMs!, 0) / timing.length : null,
    missingTimingGroups: recordings.length - timing.length,
  };
}
/** Negative is better; unavailable timing can never win by pretending to be zero. */
export function compareTrainingScores(a: DatasetScore, b: DatasetScore): number {
  if (
    a.version !== b.version ||
    a.comparisonFingerprint !== b.comparisonFingerprint ||
    a.assignment !== b.assignment
  )
    throw new Error("Scores require the same fixed comparison plan and split");
  const primary = (a.errorsPerSecond ?? Infinity) - (b.errorsPerSecond ?? Infinity);
  if (a.errorsPerSecond !== b.errorsPerSecond) return primary;
  if (a.missingTimingGroups !== b.missingTimingGroups)
    return a.missingTimingGroups - b.missingTimingGroups;
  const x = a.meanAbsoluteMs ?? Infinity,
    y = b.meanAbsoluteMs ?? Infinity;
  return x === y ? 0 : x - y;
}
function seededRank(seed: number, value: string) {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
/** Preserve saved assignments; only unassigned groups are eligible for automatic splitting. */
export function assignTrainingGroups(input: TrainingManifest, seed: number): TrainingManifest {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("Seed must be uint32");
  const m = validateTrainingManifest(input),
    groups = m.groups,
    active = groups.filter((g) =>
      m.examples.some((e) => g.sourceChecksums.includes(e.sourceChecksum)),
    );
  sourceLineages(m);
  const pending = active
    .filter((g) => g.assignment === "unassigned")
    .sort((a, b) => seededRank(seed, a.id) - seededRank(seed, b.id) || (a.id < b.id ? -1 : 1));
  let train = active.filter((g) => g.assignment === "training").length,
    withheld = active.filter((g) => g.assignment === "withheld").length;
  const target = active.length > 1 ? Math.max(1, Math.round(active.length * 0.2)) : 0;
  if (!train && pending.length) {
    pending.shift()!.assignment = "training";
    train++;
  }
  for (const g of pending) {
    if (withheld < target && train > 0) {
      g.assignment = "withheld";
      withheld++;
    } else {
      g.assignment = "training";
      train++;
    }
  }
  return m;
}
