/** Token bucket: `rate` tokens per second, at most `burst` stored. Time in ms (injectable for tests). */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.last = now;
  }
  private refill(now: number): void {
    const dt = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.rate);
  }
  /** Take `n` tokens if available. */
  take(now: number, n = 1): boolean {
    this.refill(now);
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
  /** How many whole tokens are available right now (without taking them). */
  available(now: number): number {
    this.refill(now);
    return Math.floor(this.tokens);
  }
}
