import {
  adaptiveGoal,
  comboBonus,
  comboMultiplier,
  DAILY_CAPS,
  GOAL_CEILING,
  GOAL_FLOOR,
  XP,
} from '@/gamification/xp';

describe('the combo multiplier', () => {
  it('pays nothing below three in a row', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(2)).toBe(1);
  });

  it('steps at three and again at six', () => {
    expect(comboMultiplier(3)).toBe(1.25);
    expect(comboMultiplier(5)).toBe(1.25);
    expect(comboMultiplier(6)).toBe(1.5);
    expect(comboMultiplier(40)).toBe(1.5);
  });

  it('never goes down as the run gets longer', () => {
    for (let run = 1; run <= 50; run += 1) {
      expect(comboMultiplier(run)).toBeGreaterThanOrEqual(comboMultiplier(run - 1));
    }
  });
});

describe('comboBonus', () => {
  it('is zero until the first tier, so a short run costs nothing to lose', () => {
    expect(comboBonus(XP.RECALL_INDEPENDENT, 0)).toBe(0);
    expect(comboBonus(XP.RECALL_INDEPENDENT, 2)).toBe(0);
  });

  it('pays only the extra, not the whole multiplied award', () => {
    // The base award is booked separately, so this must be the difference alone --
    // otherwise an unprompted answer in a run is paid twice.
    expect(comboBonus(XP.RECALL_INDEPENDENT, 3)).toBe(2); // 6 * 0.25
    expect(comboBonus(XP.RECALL_INDEPENDENT, 6)).toBe(3); // 6 * 0.5
  });

  it('is never negative, whatever the base', () => {
    for (const base of [0, 1, 6, 50]) {
      for (const run of [0, 2, 3, 6, 99]) {
        expect(comboBonus(base, run)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('the daily caps', () => {
  it('leaves finishing things uncapped', () => {
    // Rounds, stages, the session and the challenge are the behaviours worth
    // rewarding; capping them would punish the long session.
    const capped = DAILY_CAPS.flatMap((group) => group.kinds);
    expect(capped).not.toContain('ROUND_COMPLETE');
    expect(capped).not.toContain('STAGE_COMPLETE');
    expect(capped).not.toContain('SESSION_COMPLETE');
    expect(capped).not.toContain('CHALLENGE_REPORTED');
  });

  it('puts the combo bonus outside the recall cap', () => {
    // Inside it, the volume ceiling would swallow the bonus and the mechanic would
    // never fire. This is the one thing about the cap table worth asserting.
    const recall = DAILY_CAPS.find((group) => group.label === 'recall');
    expect(recall?.kinds).not.toContain('COMBO_BONUS');
    expect(DAILY_CAPS.some((group) => group.kinds.includes('COMBO_BONUS'))).toBe(true);
  });

  it('never lists a kind in two groups', () => {
    const seen = DAILY_CAPS.flatMap((group) => group.kinds);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('keeps recall grinding alone below the default goal', () => {
    // The whole point of the rebalance: recall plus its rounds plus the
    // first-activity bonus must not reach 60 on its own.
    const recallCap = DAILY_CAPS.find((group) => group.label === 'recall')?.limit ?? 0;
    const comboCap = DAILY_CAPS.find((group) => group.label === 'combo bonus')?.limit ?? 0;
    const twoRounds = XP.ROUND_COMPLETE * 2;
    const grindCeiling = recallCap + comboCap + twoRounds + XP.FIRST_ACTIVITY_OF_DAY;
    expect(grindCeiling).toBeLessThan(60);
  });
});

describe('adaptiveGoal', () => {
  it('leaves the goal alone until there are seven days to judge', () => {
    expect(adaptiveGoal([], 60)).toBe(60);
    expect(adaptiveGoal([100, 100, 100, 100, 100, 100], 60)).toBe(60);
  });

  it('moves by at most one step of ten', () => {
    expect(adaptiveGoal([200, 200, 200, 200, 200, 200, 200], 60)).toBe(70);
    expect(adaptiveGoal([10, 10, 10, 10, 10, 10, 10], 100)).toBe(90);
  });

  it('uses the median, so one heroic day cannot raise the bar', () => {
    const steady = [60, 60, 60, 60, 60, 60, 600];
    // Median 60 -> target 45 -> rounds to 50, one step down from 60.
    expect(adaptiveGoal(steady, 60)).toBe(50);
  });

  it('holds still when the target already matches', () => {
    // Median 80 -> 75% is 60 -> already the goal.
    expect(adaptiveGoal([80, 80, 80, 80, 80, 80, 80], 60)).toBe(60);
  });

  it('never suggests outside the floor and ceiling', () => {
    for (const daily of [0, 5, 60, 400, 10_000]) {
      const history = Array.from({ length: 7 }, () => daily);
      let goal = 60;
      // Walk it forward so the one-step clamp cannot hide an out-of-range target.
      for (let day = 0; day < 40; day += 1) goal = adaptiveGoal(history, goal);
      expect(goal).toBeGreaterThanOrEqual(GOAL_FLOOR);
      expect(goal).toBeLessThanOrEqual(GOAL_CEILING);
    }
  });

  it('does not drift when nothing changes', () => {
    const history = [70, 70, 70, 70, 70, 70, 70];
    const settled = adaptiveGoal(history, 50);
    expect(adaptiveGoal(history, settled)).toBe(settled);
  });
});
