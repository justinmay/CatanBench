export interface RandomResult {
  state: number;
  value: number;
}

export function hashSeed(seed: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash === 0 ? 0x9e3779b9 : hash >>> 0;
}

export function nextRandom(state: number): RandomResult {
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;

  if (next === 0) {
    next = 0x9e3779b9;
  }

  return { state: next, value: next / 0x1_0000_0000 };
}

export function randomInteger(
  state: number,
  maximumExclusive: number,
): RandomResult {
  if (!Number.isInteger(maximumExclusive) || maximumExclusive <= 0) {
    throw new RangeError("maximumExclusive must be a positive integer");
  }

  const random = nextRandom(state);
  return {
    state: random.state,
    value: Math.floor(random.value * maximumExclusive),
  };
}

export function shuffle<T>(
  values: readonly T[],
  initialState: number,
): { values: T[]; state: number } {
  const shuffled = [...values];
  let state = initialState;

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const random = randomInteger(state, index + 1);
    state = random.state;
    const other = random.value;
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }

  return { values: shuffled, state };
}
