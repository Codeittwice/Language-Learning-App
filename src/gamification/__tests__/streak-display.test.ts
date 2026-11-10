import { AT_RISK_HOUR, streakDisplay } from '@/gamification/streak';

const met = { current: 12, atRisk: false };
const pending = { current: 12, atRisk: true };
const fresh = { current: 0, atRisk: true };

describe('streakDisplay', () => {
  it('reads as safe once today is banked, at any hour', () => {
    for (const hour of [0, 9, 18, 23]) {
      expect(streakDisplay(met, hour)).toBe('safe');
    }
  });

  it('keeps the flame lit all morning when today is still open', () => {
    // The bug this exists to prevent: `atRisk` is true from the moment the learning
    // day starts, so every morning used to open by telling the learner their streak
    // was in danger when they had fourteen hours left.
    expect(streakDisplay(pending, 0)).toBe('pending');
    expect(streakDisplay(pending, 9)).toBe('pending');
    expect(streakDisplay(pending, AT_RISK_HOUR - 1)).toBe('pending');
  });

  it('turns to at risk from the evening onwards', () => {
    expect(streakDisplay(pending, AT_RISK_HOUR)).toBe('at_risk');
    expect(streakDisplay(pending, 23)).toBe('at_risk');
  });

  it('never shows a bare zero as a broken streak', () => {
    // Someone with no run going has nothing to lose, so there is nothing at risk --
    // whatever the hour. The UI shows an invitation instead.
    for (const hour of [0, 12, 18, 23]) {
      expect(streakDisplay(fresh, hour)).toBe('none');
    }
  });

  it('treats a zero streak as none even in the impossible met state', () => {
    expect(streakDisplay({ current: 0, atRisk: false }, 12)).toBe('none');
  });
});
