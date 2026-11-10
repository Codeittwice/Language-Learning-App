/**
 * Levels and tiers.
 *
 * The app had XP but nowhere for it to go: `daily_activity.xp` reset every morning,
 * so a month of work left no visible trace. A level is the trace. It is derived, never
 * stored -- `levelFromXp(sum(xp_events.amount))` is the whole system, which means it
 * cannot drift out of step with the events that earned it and needs no migration when
 * the curve is retuned.
 *
 * The curve:
 *
 *   cost(L)       = 60 + 40 L        XP to go from level L to L + 1
 *   cumulative(L) = (L - 1)(60 + 20 L)   total XP needed to BE level L
 *
 * Level 1 to 2 costs 100 and every level after costs 40 more than the last. One line
 * of arithmetic beats a hand-maintained threshold table: there is no cliff to tune, no
 * table to keep in step with the balance, and the inverse is closed-form so finding a
 * level from a total is O(1) rather than a loop over every level ever reached.
 *
 * At a 70 XP day -- roughly one short session -- level 7 lands around day 17, level 11
 * around day 40 and level 26 around month seven, which is the right shape for a
 * six-month course meant to be repeated.
 */

/** XP required to go from `level` to `level + 1`. */
export function levelCost(level: number): number {
  return 60 + 40 * Math.max(1, Math.floor(level));
}

/** Total lifetime XP required to be at `level`. Level 1 is the floor, at 0 XP. */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return (l - 1) * (60 + 20 * l);
}

/**
 * The level a lifetime total sits in.
 *
 * Closed-form inverse of `xpForLevel`: 20L² + 40L - 60 = xp solves to
 * L = (-40 + sqrt(6400 + 80 xp)) / 40. The result is then nudged by the two
 * neighbouring levels, because `Math.sqrt` on a value that lands exactly on a
 * boundary can fall a hair either side of it and report level 6 for someone who has
 * just earned their seventh.
 */
export function levelFromXp(totalXp: number): number {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = Math.floor((-40 + Math.sqrt(6400 + 80 * xp)) / 40);
  level = Math.max(1, level);
  while (xpForLevel(level + 1) <= xp) level += 1;
  while (level > 1 && xpForLevel(level) > xp) level -= 1;
  return level;
}

export type Tier = {
  /** Lowest level in this tier. */
  from: number;
  /** Highest level, or null for the open-ended final tier. */
  to: number | null;
  /** The Dutch name, which is what the learner sees. */
  name: string;
  /** What the name means, in English. */
  meaning: string;
  /**
   * What reaching this tier opens. Always an EXTRA mode, never anything from the
   * six-month course -- gating the thing someone came for is how a learning app
   * turns into a slot machine.
   */
  opens: readonly string[];
};

export const TIERS: readonly Tier[] = [
  {
    from: 1,
    to: 5,
    name: 'Kennismaking',
    meaning: 'Getting acquainted',
    opens: ['Every stage of the course is already open'],
  },
  {
    from: 6,
    to: 10,
    name: 'Op de markt',
    meaning: 'At the market',
    opens: ['Spoken-cue recall', 'Market & shops phrase pack'],
  },
  {
    from: 11,
    to: 15,
    name: 'Op de borrel',
    meaning: 'At the drinks',
    opens: ['Longer Friend Mode', 'Informal register drills'],
  },
  {
    from: 16,
    to: 20,
    name: 'Op het werk',
    meaning: 'At work',
    opens: ['Formal u / jij drills', 'B1 writing feedback'],
  },
  {
    from: 21,
    to: 25,
    name: 'Op bezoek',
    meaning: 'Visiting',
    opens: ['Native-speed listening', 'Regional accents'],
  },
  {
    from: 26,
    to: null,
    name: 'Onder vrienden',
    meaning: 'Among friends',
    opens: ['Your own topics', 'Nothing left locked'],
  },
];

export function tierForLevel(level: number): Tier {
  const l = Math.max(1, Math.floor(level));
  // Walk from the top so the open-ended final tier needs no special case.
  for (let i = TIERS.length - 1; i >= 0; i -= 1) {
    const tier = TIERS[i]!;
    if (l >= tier.from) return tier;
  }
  return TIERS[0]!;
}

/** The tier after this one, or null at the top. */
export function nextTier(level: number): Tier | null {
  const current = tierForLevel(level);
  const index = TIERS.indexOf(current);
  return index >= 0 && index < TIERS.length - 1 ? (TIERS[index + 1] ?? null) : null;
}

export type LevelState = {
  level: number;
  tier: Tier;
  /** Which tier this is, 1-based, for "tier 2 of 6". */
  tierIndex: number;
  tierCount: number;
  /** Lifetime XP. */
  totalXp: number;
  /** XP earned since reaching this level. */
  intoLevel: number;
  /** XP this level costs in total. */
  levelCost: number;
  /** XP still needed for the next level. */
  toNextLevel: number;
  /** Lifetime XP at which the next level arrives. */
  nextLevelAt: number;
  /** 0..1 through the current level, for a ring or bar. */
  progress: number;
};

/** Everything a screen needs about where a lifetime total has got to. */
export function levelStateFromXp(totalXp: number): LevelState {
  const xp = Math.max(0, Math.floor(totalXp));
  const level = levelFromXp(xp);
  const floorXp = xpForLevel(level);
  const cost = levelCost(level);
  const intoLevel = xp - floorXp;
  const tier = tierForLevel(level);

  return {
    level,
    tier,
    tierIndex: TIERS.indexOf(tier) + 1,
    tierCount: TIERS.length,
    totalXp: xp,
    intoLevel,
    levelCost: cost,
    toNextLevel: Math.max(0, cost - intoLevel),
    nextLevelAt: floorXp + cost,
    progress: cost > 0 ? Math.min(1, intoLevel / cost) : 0,
  };
}
