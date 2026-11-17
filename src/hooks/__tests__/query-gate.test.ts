import {
  gateOnBlur,
  gateOnEvent,
  gateOnFocus,
  type GateState,
  initialGate,
} from '@/hooks/query-gate';

/** Focus a fresh gate, the way mounting a visible screen does. */
function focused(refreshOnFocus = true): GateState {
  return gateOnFocus(initialGate, refreshOnFocus).state;
}

describe('the focus gate', () => {
  it('starts blurred and clean', () => {
    expect(initialGate).toEqual({ isFocused: false, isStale: false });
  });

  it('reads on an event while the screen is visible', () => {
    const decision = gateOnEvent(focused());
    expect(decision.read).toBe(true);
    expect(decision.state.isStale).toBe(false);
  });

  it('never reads on an event while the screen is away', () => {
    // The regression this exists to prevent: a graded recall card emits five to seven
    // events, and the Progress tab was reading ~23 statements for each one behind the
    // session screen.
    const away = gateOnBlur(focused());
    const decision = gateOnEvent(away);
    expect(decision.read).toBe(false);
    expect(decision.state.isStale).toBe(true);
  });

  it('collapses any number of events while away into one read on return', () => {
    let state = gateOnBlur(focused());
    let reads = 0;

    for (let i = 0; i < 7; i += 1) {
      const decision = gateOnEvent(state);
      state = decision.state;
      if (decision.read) reads += 1;
    }
    expect(reads).toBe(0);

    const back = gateOnFocus(state, true);
    expect(back.read).toBe(true);
    expect(back.state.isStale).toBe(false);
  });

  it('reads on return even when the screen opted out of focus refresh', () => {
    // Otherwise a `refreshOnFocus: false` screen would knowingly show stale numbers.
    const away = gateOnBlur(focused(false));
    const state = gateOnEvent(away).state;
    expect(gateOnFocus(state, false).read).toBe(true);
  });

  it('does not read on return for an opted-out screen when nothing changed', () => {
    const away = gateOnBlur(focused(false));
    expect(gateOnFocus(away, false).read).toBe(false);
  });

  it('always reads on focus when the screen asked for it', () => {
    const away = gateOnBlur(focused());
    expect(gateOnFocus(away, true).read).toBe(true);
  });

  it('clears staleness once it has been read', () => {
    let state = gateOnBlur(focused());
    state = gateOnEvent(state).state;
    expect(state.isStale).toBe(true);

    state = gateOnFocus(state, true).state;
    expect(state.isStale).toBe(false);

    // And a second focus without an intervening event is not stale either.
    expect(gateOnFocus(gateOnBlur(state), false).read).toBe(false);
  });

  it('survives a blur without a preceding focus', () => {
    expect(gateOnBlur(initialGate)).toEqual({ isFocused: false, isStale: false });
  });
});
