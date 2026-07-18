import { TurnStatus } from './turn.types';

export const TURN_TRANSITIONS: Readonly<Record<TurnStatus, readonly TurnStatus[]>> = {
  started: ['streaming', 'failed', 'cancelled'],
  streaming: ['processing', 'failed', 'cancelled'],
  processing: ['completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
} as const;

export function canTransition(from: TurnStatus, to: TurnStatus): boolean {
  return TURN_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TurnStatus, to: TurnStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid turn transition from '${from}' to '${to}'.`);
  }
}
