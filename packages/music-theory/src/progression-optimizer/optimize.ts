import type { Voicing } from "../voicings/index.js";
import type {
  OptimizedVoicingStep,
  ProgressionCandidateInput,
  ProgressionOptimizationOptions,
  ProgressionOptimizationResult,
} from "./types.js";

const DEFAULTS: Required<ProgressionOptimizationOptions> = {
  limit: 5,
  localScoreWeight: 0.35,
  chordConfidenceWeight: 3.0,
  positionShiftWeight: 1.2,
  stringMovementWeight: 0.35,
  muteChangeWeight: 1.1,
  bassMovementWeight: 0.15,
};

interface NormalizedCandidate {
  voicing: Voicing;
  chordConfidence: number;
}

interface PathState {
  candidateIndex: number;
  candidateIndexes: number[];
  steps: OptimizedVoicingStep[];
  totalCost: number;
}

function validateOptions(input: ProgressionOptimizationOptions): Required<ProgressionOptimizationOptions> {
  const options = { ...DEFAULTS, ...input };
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new RangeError("limit must be an integer from 1 to 100.");
  }
  for (const [name, value] of Object.entries(options)) {
    if (name === "limit") continue;
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a finite non-negative number.`);
    }
  }
  return options;
}

function normalizeCandidate(input: ProgressionCandidateInput): NormalizedCandidate {
  if ("voicing" in input) {
    const confidence = input.chordConfidence ?? 1;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new RangeError("chordConfidence must be between 0 and 1.");
    }
    return { voicing: input.voicing, chordConfidence: confidence };
  }
  return { voicing: input, chordConfidence: 1 };
}

function validateCandidateLayers(
  layers: readonly (readonly ProgressionCandidateInput[])[],
): NormalizedCandidate[][] {
  if (layers.length === 0) throw new RangeError("At least one chord candidate layer is required.");
  let stringCount: number | undefined;

  return layers.map((layer, layerIndex) => {
    if (layer.length === 0) throw new RangeError(`Candidate layer ${layerIndex} is empty.`);
    return layer.map((input) => {
      const candidate = normalizeCandidate(input);
      const { voicing } = candidate;
      if (!voicing.chordSymbol) throw new TypeError("Each candidate must have a chord symbol.");
      if (!Number.isFinite(voicing.score)) throw new TypeError("Each candidate must have a finite voicing score.");
      if (!Array.isArray(voicing.strings)) throw new TypeError("Each candidate must contain a string array.");
      if (stringCount === undefined) stringCount = voicing.strings.length;
      if (voicing.strings.length !== stringCount) {
        throw new TypeError("All voicings in a progression must use the same number of strings.");
      }
      voicing.strings.forEach((note, index) => {
        if (note === null) return;
        if (!Number.isInteger(note.fret) || note.fret < 0 || !Number.isFinite(note.midi)) {
          throw new TypeError("Voicing notes must have a non-negative integer fret and finite MIDI pitch.");
        }
        if (note.string !== index + 1) {
          throw new TypeError("Voicing strings must be ordered low to high with 1-based string numbers.");
        }
      });
      return candidate;
    });
  });
}

function medianFrettedPosition(voicing: Voicing): number {
  const frets = voicing.strings
    .filter((note) => note !== null && note.fret > 0)
    .map((note) => note!.fret)
    .sort((a, b) => a - b);
  if (frets.length === 0) return 0;
  const middle = Math.floor(frets.length / 2);
  return frets.length % 2 === 1
    ? frets[middle]!
    : (frets[middle - 1]! + frets[middle]!) / 2;
}

function lowestMidi(voicing: Voicing): number | undefined {
  const sounding = voicing.strings.filter((note) => note !== null).map((note) => note!.midi);
  return sounding.length ? Math.min(...sounding) : undefined;
}

/** Cost of moving from one valid voicing to the next. Lower is more convenient. */
export function scoreVoicingTransition(
  previous: Voicing,
  next: Voicing,
  options: ProgressionOptimizationOptions = {},
): number {
  const weights = validateOptions(options);
  if (previous.strings.length !== next.strings.length) {
    throw new TypeError("Voicings in a transition must use the same number of strings.");
  }

  let stringMovement = 0;
  let muteChanges = 0;
  for (let i = 0; i < previous.strings.length; i++) {
    const before = previous.strings[i];
    const after = next.strings[i];
    if (before === undefined || after === undefined) {
      throw new TypeError("Voicing string arrays must have matching lengths.");
    }
    if (before === null && after === null) continue;
    if (before === null || after === null) {
      muteChanges += 1;
      continue;
    }
    stringMovement += Math.abs(before.fret - after.fret);
  }

  const positionShift = Math.abs(medianFrettedPosition(previous) - medianFrettedPosition(next));
  const beforeBass = lowestMidi(previous);
  const afterBass = lowestMidi(next);
  const bassMovement = beforeBass === undefined || afterBass === undefined
    ? 0
    : Math.abs(beforeBass - afterBass);

  return positionShift * weights.positionShiftWeight
    + stringMovement * weights.stringMovementWeight
    + muteChanges * weights.muteChangeWeight
    + bassMovement * weights.bassMovementWeight;
}

function compareIndexPaths(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

function compareStates(a: PathState, b: PathState): number {
  const difference = a.totalCost - b.totalCost;
  return Math.abs(difference) > 1e-9 ? difference : compareIndexPaths(a.candidateIndexes, b.candidateIndexes);
}

/**
 * Selects low-cost candidate chord/fingering paths using a layered k-best dynamic program.
 * A layer can contain alternate voicings for a known chord, or hypotheses for different chords.
 */
export function optimizeVoicingProgression(
  candidateLayers: readonly (readonly ProgressionCandidateInput[])[],
  input: ProgressionOptimizationOptions = {},
): ProgressionOptimizationResult {
  const options = validateOptions(input);
  const normalizedLayers = validateCandidateLayers(candidateLayers);

  let pathExtensionsEvaluated = 0;
  let statesByCandidate: PathState[][] = normalizedLayers[0]!.map((candidate, candidateIndex) => {
    const localCost = candidate.voicing.score * options.localScoreWeight;
    const chordPenalty = (1 - candidate.chordConfidence) * options.chordConfidenceWeight;
    return [{
      candidateIndex,
      candidateIndexes: [candidateIndex],
      steps: [{
        chordSymbol: candidate.voicing.chordSymbol,
        candidateIndex,
        voicing: candidate.voicing,
        chordConfidence: candidate.chordConfidence,
        chordPenalty,
        localCost,
        transitionCost: 0,
        cumulativeCost: localCost + chordPenalty,
      }],
      totalCost: localCost + chordPenalty,
    }];
  });

  for (let layerIndex = 1; layerIndex < normalizedLayers.length; layerIndex++) {
    const previousLayer = normalizedLayers[layerIndex - 1]!;
    const currentLayer = normalizedLayers[layerIndex]!;
    const nextStates: PathState[][] = currentLayer.map(() => []);

    currentLayer.forEach((currentCandidate, currentIndex) => {
      const currentVoicing = currentCandidate.voicing;
      const localCost = currentVoicing.score * options.localScoreWeight;
      const chordPenalty = (1 - currentCandidate.chordConfidence) * options.chordConfidenceWeight;
      const pathsForCurrent: PathState[] = [];

      previousLayer.forEach((previousCandidate, previousIndex) => {
        const transitionCost = scoreVoicingTransition(previousCandidate.voicing, currentVoicing, options);
        for (const previousState of statesByCandidate[previousIndex]!) {
          pathExtensionsEvaluated += 1;
          const cumulativeCost = previousState.totalCost + transitionCost + localCost + chordPenalty;
          const step: OptimizedVoicingStep = {
            chordSymbol: currentVoicing.chordSymbol,
            candidateIndex: currentIndex,
            voicing: currentVoicing,
            chordConfidence: currentCandidate.chordConfidence,
            chordPenalty,
            localCost,
            transitionCost,
            cumulativeCost,
          };
          pathsForCurrent.push({
            candidateIndex: currentIndex,
            candidateIndexes: [...previousState.candidateIndexes, currentIndex],
            steps: [...previousState.steps, step],
            totalCost: cumulativeCost,
          });
        }
      });

      pathsForCurrent.sort(compareStates);
      nextStates[currentIndex] = pathsForCurrent.slice(0, options.limit);
    });

    statesByCandidate = nextStates;
  }

  const results = statesByCandidate.flat()
    .sort(compareStates)
    .slice(0, options.limit)
    .map((state) => ({ steps: state.steps, totalCost: state.totalCost }));

  return {
    results,
    candidateCounts: normalizedLayers.map((layer) => layer.length),
    pathExtensionsEvaluated,
    options,
  };
}
