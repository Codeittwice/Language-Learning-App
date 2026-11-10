/**
 * What a session is made of.
 *
 * Each stage is divided into rounds of a few interactions. The round, not the stage,
 * is the unit of satisfaction -- a short bar that fills, then a reward beat -- which
 * is what lets the spec's forty-minute session be consumed across several sittings
 * without changing any of its pedagogy.
 *
 */
import type { DurationMode, SessionStage } from '@/types';

export type RoundPlan = {
  index: number;
  /** How many prompts, messages or turns this round contains. */
  items: number;
};

export type StagePlan = {
  stage: SessionStage;
  order: number;
  rounds: RoundPlan[];
  /** Total interactions across the stage, used for progress display. */
  totalItems: number;
};

type StageSpec = { stage: SessionStage; rounds: number[] };

/**
 * Stage sizes per mode. The `standard` recall figure of 4 + 4 is the spec's
 * "6-8 due or weak phrases", split into two rounds so there is a reward beat in the
 * middle rather than only at the end.
 */
const SPECS: Record<DurationMode, StageSpec[]> = {
  quick: [
    { stage: 'recall', rounds: [4] },
    { stage: 'casual_conversation', rounds: [4] },
    { stage: 'wrap_up', rounds: [1] },
  ],
  short: [
    { stage: 'recall', rounds: [3, 2] },
    { stage: 'listening', rounds: [3] },
    { stage: 'writing', rounds: [1] },
    { stage: 'topic_conversation', rounds: [1, 1, 1] },
    { stage: 'casual_conversation', rounds: [5] },
    { stage: 'wrap_up', rounds: [1] },
  ],
  standard: [
    { stage: 'recall', rounds: [4, 4] },
    { stage: 'listening', rounds: [3] },
    { stage: 'writing', rounds: [1] },
    { stage: 'topic_conversation', rounds: [1, 1, 1] },
    { stage: 'casual_conversation', rounds: [6, 6] },
    { stage: 'wrap_up', rounds: [1] },
  ],
};

export function planFor(mode: DurationMode): StagePlan[] {
  return SPECS[mode].map((spec, order) => ({
    stage: spec.stage,
    order,
    rounds: spec.rounds.map((items, index) => ({ index, items })),
    totalItems: spec.rounds.reduce((sum, items) => sum + items, 0),
  }));
}

export function stagesFor(mode: DurationMode): SessionStage[] {
  return SPECS[mode].map((spec) => spec.stage);
}

/** How many recall prompts this mode asks for in total. */
export function recallItemCount(mode: DurationMode): number {
  const recall = SPECS[mode].find((spec) => spec.stage === 'recall');
  return recall ? recall.rounds.reduce((sum, items) => sum + items, 0) : 0;
}

export function roundsForStage(mode: DurationMode, stage: SessionStage): RoundPlan[] {
  return planFor(mode).find((plan) => plan.stage === stage)?.rounds ?? [];
}

/** The stage after `stage`, or null when the session is finished. */
export function nextStageAfter(mode: DurationMode, stage: SessionStage): SessionStage | null {
  const stages = stagesFor(mode);
  const index = stages.indexOf(stage);
  if (index === -1 || index === stages.length - 1) return null;
  return stages[index + 1] ?? null;
}

export function firstStage(mode: DurationMode): SessionStage {
  const stages = stagesFor(mode);
  const first = stages[0];
  if (!first) throw new Error(`Empty plan for mode ${mode}`);
  return first;
}

/**
 * At most three to five new phrases per standard session, fewer when existing ones
 * are still difficult (spec section 6).
 */
export function newPhraseAllowance(mode: DurationMode, strugglingCount: number): number {
  const base = mode === 'standard' ? 5 : mode === 'short' ? 3 : 2;
  if (strugglingCount >= 8) return Math.max(0, base - 3);
  if (strugglingCount >= 4) return Math.max(0, base - 2);
  return base;
}
