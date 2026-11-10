/**
 * What the daily reminder actually says.
 *
 * This is the whole reason the app schedules fourteen individual notifications rather
 * than one repeating DAILY trigger: a repeating trigger carries one fixed string
 * forever, and "Time to practise!" every evening for a year is precisely the
 * notification that gets swiped away unread.
 *
 * Two rules:
 *  - Never the literal phrase "time to practice".
 *  - Interpolate only values read from the database during the reconcile pass -- a
 *    phrase actually in the bank, a real due count, a real streak number. A reminder
 *    that claims something untrue is worse than no reminder.
 */
import type { RotationTopic } from '@/session/rotation';
import { type DayKey, diffDayKeys } from '@/time/day';

export type CopyContext = {
  dayKey: DayKey;
  streak: number;
  longestStreak: number;
  dueCount: number;
  sessionNumber: number;
  topic: RotationTopic;
  /** A real phrase from the bank, or null when it is empty. */
  samplePhrase: { dutch: string; meaningEn: string } | null;
  /** The open real-world challenge, if one is outstanding. */
  challenge: string | null;
  sport: string | null;
};

export type ReminderCopy = {
  title: string;
  body: string;
  data: { route: string };
};

type Template = {
  id: string;
  /** Only offered when this holds, so nothing claims something untrue. */
  eligible: (ctx: CopyContext) => boolean;
  render: (ctx: CopyContext) => ReminderCopy;
};

const TO_SESSION = { route: '/session/today' };
/** A short round. `/session/today` resolves what that means right now. */
const TO_QUICK = { route: '/session/today?mode=quick' };

const always = () => true;

/**
 * Eight families. The ones that lead with real content perform best, because the
 * notification itself is already a tiny bit of practice.
 */
const TEMPLATES: Template[] = [
  // --- Real content as the hook -------------------------------------------
  {
    id: 'phrase-recall',
    eligible: (ctx) => ctx.samplePhrase !== null,
    render: (ctx) => ({
      title: `Weet je nog? "${ctx.samplePhrase!.dutch}"`,
      body: 'Tap to see if you have still got it.',
      data: TO_QUICK,
    }),
  },
  {
    id: 'phrase-meaning',
    eligible: (ctx) => ctx.samplePhrase !== null,
    render: (ctx) => ({
      title: `How would you say "${ctx.samplePhrase!.meaningEn}"?`,
      body: 'You learned this one. Four minutes to find out.',
      data: TO_QUICK,
    }),
  },
  {
    id: 'phrase-use',
    eligible: (ctx) => ctx.samplePhrase !== null,
    render: (ctx) => ({
      title: `"${ctx.samplePhrase!.dutch}"`,
      body: 'Use it in a sentence of your own and it sticks for good.',
      data: TO_SESSION,
    }),
  },

  // --- Curiosity ------------------------------------------------------------
  {
    id: 'curiosity-teammates',
    eligible: always,
    render: () => ({
      title: 'One Dutch phrase your teammates actually use',
      body: 'Not the textbook version. Four minutes.',
      data: TO_SESSION,
    }),
  },
  {
    id: 'curiosity-sounds-native',
    eligible: always,
    render: () => ({
      title: 'The small word that makes you sound Dutch',
      body: 'Most learners skip it. You do not have to.',
      data: TO_SESSION,
    }),
  },
  {
    id: 'curiosity-de-het',
    eligible: always,
    render: () => ({
      title: 'de or het?',
      body: 'Two thirds are de. Tonight, learn the ones that are not.',
      data: TO_QUICK,
    }),
  },

  // --- Concrete stakes ------------------------------------------------------
  {
    id: 'due-count',
    eligible: (ctx) => ctx.dueCount >= 3,
    render: (ctx) => ({
      title: `${ctx.dueCount} phrases are due`,
      body: 'Clear them in about five minutes and the day is done.',
      data: TO_QUICK,
    }),
  },
  {
    id: 'due-small',
    eligible: (ctx) => ctx.dueCount > 0 && ctx.dueCount < 3,
    render: (ctx) => ({
      title: `Only ${ctx.dueCount} due today`,
      body: 'This is the easiest the day is going to get.',
      data: TO_QUICK,
    }),
  },
  {
    id: 'due-fading',
    eligible: (ctx) => ctx.dueCount >= 6,
    render: (ctx) => ({
      title: `${ctx.dueCount} phrases are starting to fade`,
      body: 'Catching them now costs a lot less than relearning them.',
      data: TO_QUICK,
    }),
  },

  // --- Streak (only when true) ---------------------------------------------
  {
    id: 'streak-day',
    eligible: (ctx) => ctx.streak >= 2,
    render: (ctx) => ({
      title: `Day ${ctx.streak}`,
      body: 'Keep it going. A short round counts.',
      data: TO_QUICK,
    }),
  },
  {
    id: 'streak-record',
    eligible: (ctx) => ctx.streak >= 3 && ctx.streak >= ctx.longestStreak,
    render: (ctx) => ({
      title: `${ctx.streak} days, your longest run yet`,
      body: 'Do not stop here.',
      data: TO_QUICK,
    }),
  },
  {
    id: 'streak-almost-week',
    eligible: (ctx) => ctx.streak === 6,
    render: () => ({
      title: 'One more day makes a full week',
      body: 'Five minutes is all it takes.',
      data: TO_QUICK,
    }),
  },

  // --- Topic tease ----------------------------------------------------------
  {
    id: 'topic-today',
    eligible: always,
    render: (ctx) => ({
      title: `Vandaag: ${ctx.topic.label.toLowerCase()}`,
      body: ctx.topic.conversation,
      data: TO_SESSION,
    }),
  },
  {
    id: 'topic-plans',
    eligible: (ctx) => ctx.topic.key === 'plans',
    render: () => ({
      title: 'Someone cancels on Saturday',
      body: 'What do you say? Tonight you practise exactly that.',
      data: TO_SESSION,
    }),
  },
  {
    id: 'topic-stories',
    eligible: (ctx) => ctx.topic.key === 'stories',
    render: () => ({
      title: 'Got a story from today?',
      body: 'Tell it in Dutch. Four sentences is a story.',
      data: TO_SESSION,
    }),
  },
  {
    id: 'topic-opinions',
    eligible: (ctx) => ctx.topic.key === 'opinions',
    render: () => ({
      title: 'Disagreeing without being rude',
      body: 'There is a Dutch way to do it. Tonight you learn it.',
      data: TO_SESSION,
    }),
  },
  {
    id: 'topic-group-chat',
    eligible: (ctx) => ctx.topic.key === 'group_chat',
    render: () => ({
      title: 'That group chat you keep reading silently',
      body: 'Tonight you practise replying in it.',
      data: TO_SESSION,
    }),
  },

  // --- Challenge follow-up --------------------------------------------------
  {
    id: 'challenge-followup',
    eligible: (ctx) => ctx.challenge !== null,
    render: (ctx) => ({
      title: 'How did it go?',
      body: `${ctx.challenge} Either way, tell me and we carry on.`,
      data: TO_SESSION,
    }),
  },
  {
    id: 'challenge-nudge',
    eligible: (ctx) => ctx.challenge !== null,
    render: () => ({
      title: 'Still got a challenge open',
      body: 'No pressure. Come and tell me either way.',
      data: TO_SESSION,
    }),
  },

  // --- Sport-flavoured ------------------------------------------------------
  {
    id: 'sport-training',
    eligible: (ctx) => ctx.sport !== null,
    render: (ctx) => ({
      title: `Dutch for ${ctx.sport}`,
      body: 'Try a phrase you could use with the people you train with.',
      data: TO_SESSION,
    }),
  },
  {
    id: 'sport-after',
    eligible: (ctx) => ctx.sport !== null,
    render: (ctx) => ({
      title: `After ${ctx.sport}, join the chat`,
      body: 'Five minutes now so you can join in next time.',
      data: TO_SESSION,
    }),
  },

  // --- Low friction ---------------------------------------------------------
  {
    id: 'low-four-minutes',
    eligible: always,
    render: () => ({
      title: 'Got four minutes?',
      body: 'One quick round. That is all.',
      data: TO_QUICK,
    }),
  },
  {
    id: 'low-tired',
    eligible: always,
    render: () => ({
      title: 'Too tired for a full session?',
      body: 'Do a short one. It still counts.',
      data: TO_QUICK,
    }),
  },
  {
    id: 'low-one-phrase',
    eligible: always,
    render: () => ({
      title: 'Just one phrase tonight',
      body: 'Start with one and see how it feels.',
      data: TO_QUICK,
    }),
  },
  {
    id: 'low-session-number',
    eligible: (ctx) => ctx.sessionNumber >= 2,
    render: (ctx) => ({
      title: `Session ${ctx.sessionNumber} is ready`,
      body: `${ctx.topic.label}. Pick a length when you open it.`,
      data: TO_SESSION,
    }),
  },
];

/** Days since the epoch, used to step through the pool one place per day. */
function dayOrdinal(dayKey: DayKey): number {
  return diffDayKeys('2020-01-01', dayKey);
}

/**
 * Pick the copy for a day.
 *
 * Stepping through the eligible list by day ordinal means consecutive days never
 * repeat while the pool is larger than the horizon, and the same day always produces
 * the same copy -- which makes it reproducible in a test.
 */
export function pickCopy(ctx: CopyContext): ReminderCopy {
  const ordinal = Math.abs(dayOrdinal(ctx.dayKey));
  const eligible = TEMPLATES.filter((template) => template.eligible(ctx));
  const pool = eligible.length > 0 ? eligible : TEMPLATES.filter((t) => t.eligible === always);
  const sport = pool.filter((template) => template.id.startsWith('sport-'));
  if (sport.length === 2 && sport[0] && sport[1]) {
    const remaining = pool.filter((template) => !template.id.startsWith('sport-'));
    remaining.unshift(sport[0]);
    remaining.splice(Math.floor(pool.length / 2), 0, sport[1]);
    return remaining[ordinal % remaining.length]!.render(ctx);
  }

  const template = pool[ordinal % pool.length];
  if (!template) {
    // Unreachable while any unconditional template exists, but never crash the
    // scheduler over copy.
    return {
      title: 'Your Dutch is waiting',
      body: 'A short round keeps it moving.',
      data: TO_QUICK,
    };
  }
  return template.render(ctx);
}

/** The late nudge, only offered when a real streak is about to break. */
export function rescueCopy(ctx: CopyContext): ReminderCopy {
  return {
    title: `${ctx.streak} days on the line`,
    body: 'A quick round can help you reach today’s goal.',
    data: TO_QUICK,
  };
}

/** Exposed for tests. */
export const TEMPLATE_COUNT = TEMPLATES.length;
export const TEMPLATE_IDS = TEMPLATES.map((template) => template.id);
