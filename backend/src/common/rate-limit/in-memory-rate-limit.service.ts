import { Injectable } from '@nestjs/common';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

@Injectable()
export class InMemoryRateLimitService {
  private readonly entries = new Map<string, RateLimitEntry>();

  consume(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const existingEntry = this.entries.get(key);

    if (existingEntry === undefined || existingEntry.resetAt <= now) {
      this.entries.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return true;
    }

    if (existingEntry.count >= limit) {
      return false;
    }

    existingEntry.count += 1;
    return true;
  }

  clear(): void {
    this.entries.clear();
  }
}
