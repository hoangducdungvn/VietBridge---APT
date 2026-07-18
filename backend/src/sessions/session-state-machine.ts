import { SessionStatus } from './session.types';

export const SESSION_TRANSITIONS: Readonly<
  Record<SessionStatus, readonly SessionStatus[]>
> = {
  waiting: ['active'],
  active: ['closing', 'error'],
  closing: ['closed'],
  closed: [],
  error: ['active'],
} as const;

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid session transition from '${from}' to '${to}'.`);
  }
}
