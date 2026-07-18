import { assertTransition, canTransition, TURN_TRANSITIONS } from './turn-state-machine';
import { TurnStatus } from './turn.types';

describe('turn-state-machine', () => {
  it('exposes the valid turn transitions', () => {
    expect(TURN_TRANSITIONS).toEqual({
      started: ['streaming', 'failed', 'cancelled'],
      streaming: ['processing', 'failed', 'cancelled'],
      processing: ['completed', 'failed'],
      completed: [],
      failed: [],
      cancelled: [],
    });
  });

  it('returns true and does not throw for all valid transitions', () => {
    const validTransitions: Array<[TurnStatus, TurnStatus]> = [
      ['started', 'streaming'],
      ['streaming', 'processing'],
      ['processing', 'completed'],
      ['started', 'failed'],
      ['streaming', 'failed'],
      ['processing', 'failed'],
      ['started', 'cancelled'],
      ['streaming', 'cancelled'],
    ];

    for (const [from, to] of validTransitions) {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it('returns false and throws for terminal state transitions', () => {
    const invalidTransitions: Array<[TurnStatus, TurnStatus]> = [
      ['completed', 'started'],
      ['failed', 'streaming'],
      ['cancelled', 'processing'],
    ];

    for (const [from, to] of invalidTransitions) {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(
        `Invalid turn transition from '${from}' to '${to}'.`,
      );
    }
  });

  it('covers failed and cancelled branches as terminal states', () => {
    expect(canTransition('started', 'failed')).toBe(true);
    expect(canTransition('streaming', 'cancelled')).toBe(true);
    expect(canTransition('failed', 'completed')).toBe(false);
    expect(canTransition('cancelled', 'completed')).toBe(false);
    expect(() => assertTransition('failed', 'completed')).toThrow(
      "Invalid turn transition from 'failed' to 'completed'.",
    );
    expect(() => assertTransition('cancelled', 'completed')).toThrow(
      "Invalid turn transition from 'cancelled' to 'completed'.",
    );
  });
});
