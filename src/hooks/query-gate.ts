/**
 * When a screen query is allowed to touch the database.
 *
 * The tab screens stay mounted while a session is pushed over them, so a screen
 * subscribed to a frequently-emitted event was re-running its whole query behind the
 * session. The Progress tab reads about twenty-three statements, and one graded recall
 * card emits five to seven matching events — so answering a single card cost well over
 * a hundred statements for a screen nobody could see.
 *
 * A blurred screen's numbers are not being read by anyone, so the right answer is to
 * remember that they went stale and read them on the way back in.
 *
 * This is a pure state machine rather than a few refs inside the hook so it can be
 * tested without a renderer, which is the convention the jest config states.
 */

export type GateState = {
  /** True while this screen is the one on screen. */
  isFocused: boolean;
  /** True when a subscribed event arrived while the screen was away. */
  isStale: boolean;
};

export type GateDecision = {
  state: GateState;
  /** Whether the caller should run the query now. */
  read: boolean;
};

export const initialGate: GateState = { isFocused: false, isStale: false };

/** A subscribed event fired. Read it now if visible, otherwise remember it. */
export function gateOnEvent(state: GateState): GateDecision {
  if (state.isFocused) return { state, read: true };
  return { state: { ...state, isStale: true }, read: false };
}

/**
 * The screen became visible.
 *
 * `refreshOnFocus` screens always read. A screen that opted out still reads when
 * something changed while it was away, or it would show numbers it knows are wrong.
 */
export function gateOnFocus(state: GateState, refreshOnFocus: boolean): GateDecision {
  const read = refreshOnFocus || state.isStale;
  return { state: { isFocused: true, isStale: false }, read };
}

/** The screen went away. Nothing to read; later events only mark it stale. */
export function gateOnBlur(state: GateState): GateState {
  return { ...state, isFocused: false };
}
