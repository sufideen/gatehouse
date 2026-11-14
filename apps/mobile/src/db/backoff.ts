/**
 * Exponential backoff with FULL jitter (random in [0, cap]) so thousands of guards coming back online
 * at the 06:00/18:00 shift change do not retry in lock-step.
 */
export function backoffDelayMs(attempt: number, rand: () => number = Math.random, baseMs = 2_000, capMs = 300_000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(rand() * ceiling);
}
