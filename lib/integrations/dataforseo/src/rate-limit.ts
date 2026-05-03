/**
 * Token-bucket rate limiter. `capacity` tokens, refills at
 * `refillPerSec` per second. `take()` resolves once a token is
 * available.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();
  private readonly capacity: number;
  private readonly refillPerSec: number;

  constructor(capacity: number, refillPerSec: number) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
  }

  private refill(): void {
    const now = Date.now();
    const delta = (now - this.lastRefill) / 1000;
    if (delta <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + delta * this.refillPerSec);
    this.lastRefill = now;
  }

  async take(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      const waitMs = Math.max(10, Math.ceil((deficit / this.refillPerSec) * 1000));
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}
