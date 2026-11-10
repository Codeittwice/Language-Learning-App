/**
 * The seven-session topic rotation from spec section 3.
 *
 * Session numbers are practice days, not weekdays: missing three calendar days does
 * not skip three topics, it just means the next session is still number N.
 */

export type RotationTopic = {
  day: number;
  key: string;
  /** Shown on the Today card. */
  label: string;
  conversation: string;
  writing: string;
  challenge: string;
  /** Used to bias recall selection towards today's material. */
  tags: string[];
};

export const ROTATION: readonly RotationTopic[] = [
  {
    day: 1,
    key: 'arrival',
    label: 'Arriving and daily life',
    conversation: 'Arriving at training, meeting peers, how the day went and how you feel',
    writing: 'A short message about what time you will arrive',
    challenge: 'Start one exchange in Dutch and ask a follow-up question.',
    tags: ['greeting', 'arrival', 'energy', 'day1'],
  },
  {
    day: 2,
    key: 'training',
    label: 'Training and teamwork',
    conversation: 'Training, matches, teamwork, and what went well',
    writing: 'A brief recap of your last training session',
    challenge: "Give an opinion and ask a teammate for theirs.",
    tags: ['training', 'volleyball', 'encouragement', 'day2'],
  },
  {
    day: 3,
    key: 'plans',
    label: 'Weekend plans',
    conversation: 'Weekend plans, invitations, agreeing a time and place',
    writing: 'An invitation, or a reply to one',
    challenge: "Ask someone about their plans.",
    tags: ['plans', 'invitation', 'day3'],
  },
  {
    day: 4,
    key: 'stories',
    label: 'Telling a story',
    conversation: 'Something funny, annoying, surprising or unexpected that happened',
    writing: 'A four to six sentence story',
    challenge: 'Tell a real story in Dutch and invite a reaction.',
    tags: ['story', 'reaction', 'day4'],
  },
  {
    day: 5,
    key: 'opinions',
    label: 'Opinions and disagreeing',
    conversation: 'Music, food, films and hobbies, including disagreeing politely',
    writing: 'A recommendation with a reason',
    challenge: 'State a preference and explain why.',
    tags: ['opinion', 'disagree', 'day5'],
  },
  {
    day: 6,
    key: 'group_chat',
    label: 'Group chats and humour',
    conversation: 'Group chats, humour, reactions, and expressions you have come across',
    writing: 'A reply to a group-chat message',
    challenge: 'Try one new expression after checking its meaning and tone.',
    tags: ['group-chat', 'reaction', 'joining', 'day6'],
  },
  {
    day: 7,
    key: 'review',
    label: 'Mixed review',
    conversation: 'Unprepared, mixed conversation and review',
    writing: 'Rewrite an earlier practice text from memory. If you have no earlier text, write a short message about a plan that changed.',
    challenge: 'Have a Dutch exchange and note what was hardest.',
    tags: ['core', 'repair', 'follow-up'],
  },
] as const;

/** Four-week progression (spec section 4). Targets, never fluency promises. */
export const WEEK_FOCUS: readonly string[] = [
  'Familiar topics, short turns, hints available.',
  'Longer answers, past events, follow-up questions, fewer hints.',
  'Unexpected questions, disagreement, changed plans, repairing misunderstandings.',
  'Mixed topics without preparation, repeating the week-one tasks.',
];

export function rotationDayFor(sessionNumber: number): number {
  return ((Math.max(1, sessionNumber) - 1) % 7) + 1;
}

export function weekFor(sessionNumber: number): number {
  return Math.floor((Math.max(1, sessionNumber) - 1) / 7) + 1;
}

export function topicFor(sessionNumber: number): RotationTopic {
  const day = rotationDayFor(sessionNumber);
  const topic = ROTATION[day - 1];
  if (!topic) throw new Error(`No rotation topic for day ${day}`);
  return topic;
}

/** After week four the rotation repeats with fresh situations, so the focus cycles. */
export function weekFocusFor(sessionNumber: number): string {
  const week = weekFor(sessionNumber);
  const index = (week - 1) % WEEK_FOCUS.length;
  return WEEK_FOCUS[index] ?? WEEK_FOCUS[0]!;
}

export function topicByKey(key: string): RotationTopic | null {
  return ROTATION.find((topic) => topic.key === key) ?? null;
}
