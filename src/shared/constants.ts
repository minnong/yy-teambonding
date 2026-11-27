export const POINTS = { icebreaker: 10, collectible: 15, riddle: 30, quizMax: 50 } as const;

export const COLLECTIBLE_MIN_MS = 20000;
export const COLLECTIBLE_MAX_MS = 30000;
export const MAX_COLLECTIBLES = 2;
export const QUIZ_MS = 20000;
export const RIDDLE_SKIP_LOCK_MS = 30000;
export const TICK_MS = 1000;
export const CALL_AMBER_MS = 270000;
export const CALL_GREEN_MS = 300000;

export const TILE = 32;
export const WALK_SPEED = 128; // px/s
export const PROXIMITY = 80; // px
export const TABLE_REACH = 48; // px from the table rect

export const EMOTES = ['wave', 'highfive', 'laugh', 'heart'] as const;
export const ACCESSORIES = ['none', 'hat', 'glasses', 'cap', 'headphones', 'bow'] as const;

// Option counts per AvatarLook field.
export const AVATAR_OPTIONS = {
  skin: 6, hair: 6, hairColor: 8, top: 3, topColor: 8, bottomsColor: 6, accessory: 6,
} as const;

export const MESSAGE_BUDGET = 30000;
