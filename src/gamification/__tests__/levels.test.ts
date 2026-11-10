import {
  levelCost,
  levelFromXp,
  levelStateFromXp,
  nextTier,
  TIERS,
  tierForLevel,
  xpForLevel,
} from '@/gamification/levels';

describe('the level curve', () => {
  it('starts level 1 at zero XP', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(levelFromXp(0)).toBe(1);
  });

  it('charges 100 for the first level and 40 more each time', () => {
    expect(levelCost(1)).toBe(100);
    expect(levelCost(2)).toBe(140);
    expect(levelCost(7)).toBe(340);
  });

  it('keeps the cumulative total and the per-level cost in step', () => {
    // The closed-form cumulative must be exactly the sum of the costs below it,
    // or the ring on the Progress screen and the "XP to next level" line disagree.
    for (let level = 1; level <= 60; level += 1) {
      expect(xpForLevel(level + 1) - xpForLevel(level)).toBe(levelCost(level));
    }
  });

  it('sums the costs to the published milestones', () => {
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(5)).toBe(640);
    expect(xpForLevel(7)).toBe(1_200);
    expect(xpForLevel(11)).toBe(2_800);
    expect(xpForLevel(16)).toBe(5_700);
    expect(xpForLevel(21)).toBe(9_600);
    expect(xpForLevel(26)).toBe(14_500);
  });
});

describe('levelFromXp', () => {
  it('inverts xpForLevel exactly on every boundary', () => {
    // The square-root inverse can land a hair either side of a boundary, which would
    // tell someone who just earned level 7 that they are still level 6.
    for (let level = 1; level <= 80; level += 1) {
      expect(levelFromXp(xpForLevel(level))).toBe(level);
    }
  });

  it('puts one XP short of a boundary in the level below', () => {
    for (let level = 2; level <= 80; level += 1) {
      expect(levelFromXp(xpForLevel(level) - 1)).toBe(level - 1);
    }
  });

  it('never returns less than level 1, whatever it is given', () => {
    expect(levelFromXp(-500)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
  });

  it('ignores fractional XP rather than rounding up into a level', () => {
    expect(levelFromXp(99.9)).toBe(1);
    expect(levelFromXp(100.9)).toBe(2);
  });
});

describe('tiers', () => {
  it('covers every level with exactly one tier', () => {
    for (let level = 1; level <= 200; level += 1) {
      const tier = tierForLevel(level);
      expect(level).toBeGreaterThanOrEqual(tier.from);
      if (tier.to !== null) expect(level).toBeLessThanOrEqual(tier.to);
    }
  });

  it('changes tier on the published boundaries', () => {
    expect(tierForLevel(5).name).toBe('Kennismaking');
    expect(tierForLevel(6).name).toBe('Op de markt');
    expect(tierForLevel(10).name).toBe('Op de markt');
    expect(tierForLevel(11).name).toBe('Op de borrel');
    expect(tierForLevel(26).name).toBe('Onder vrienden');
  });

  it('leaves the last tier open-ended', () => {
    const last = TIERS[TIERS.length - 1]!;
    expect(last.to).toBeNull();
    expect(tierForLevel(999)).toBe(last);
    expect(nextTier(26)).toBeNull();
  });

  it('points at the tier above from anywhere below it', () => {
    expect(nextTier(1)?.name).toBe('Op de markt');
    expect(nextTier(7)?.name).toBe('Op de borrel');
  });
});

describe('levelStateFromXp', () => {
  it('reports progress through the current level', () => {
    const state = levelStateFromXp(1_480);
    expect(state.level).toBe(7);
    expect(state.tier.name).toBe('Op de markt');
    expect(state.tierIndex).toBe(2);
    expect(state.tierCount).toBe(6);
    expect(state.intoLevel).toBe(280);
    expect(state.levelCost).toBe(340);
    expect(state.toNextLevel).toBe(60);
    expect(state.nextLevelAt).toBe(1_540);
    expect(state.progress).toBeCloseTo(280 / 340);
  });

  it('sits at zero progress the moment a level is reached', () => {
    const state = levelStateFromXp(xpForLevel(7));
    expect(state.level).toBe(7);
    expect(state.intoLevel).toBe(0);
    expect(state.progress).toBe(0);
    expect(state.toNextLevel).toBe(levelCost(7));
  });

  it('treats a brand-new learner as level 1 with nothing earned', () => {
    const state = levelStateFromXp(0);
    expect(state.level).toBe(1);
    expect(state.totalXp).toBe(0);
    expect(state.progress).toBe(0);
    expect(state.tier.name).toBe('Kennismaking');
  });
});
