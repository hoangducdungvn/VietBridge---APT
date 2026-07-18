import { assertTransition, canTransition, SESSION_TRANSITIONS } from './session-state-machine';
import { SessionStatus } from './session.types';

describe('session-state-machine', () => {
  it('exposes the valid session transitions', () => {
    expect(SESSION_TRANSITIONS).toEqual({
      waiting: ['active'],
      active: ['closing', 'error'],
      closing: ['closed'],
      closed: [],
      error: ['active'],
    });
  });

  it('returns true and does not throw for all valid transitions', () => {
    const validTransitions: Array<[SessionStatus, SessionStatus]> = [
      ['waiting', 'active'],
      ['active', 'closing'],
      ['closing', 'closed'],
      ['active', 'error'],
      ['error', 'active'],
    ];

    for (const [from, to] of validTransitions) {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it('returns false and throws for invalid transitions', () => {
    const invalidTransitions: Array<[SessionStatus, SessionStatus]> = [
      ['closed', 'active'],
      ['waiting', 'closed'],
      ['closing', 'active'],
    ];

    for (const [from, to] of invalidTransitions) {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(
        `Invalid session transition from '${from}' to '${to}'.`,
      );
    }
  });

  it('allows recoverable error to active transition', () => {
    expect(canTransition('error', 'active')).toBe(true);
    expect(() => assertTransition('error', 'active')).not.toThrow();
  });
});
