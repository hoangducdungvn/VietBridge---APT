import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiHttpException } from '../common/errors/api-http.exception';
import type { ParticipantTokenClaims } from './participant-token.types';

const PARTICIPANT_TOKEN_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class ParticipantTokenService {
  private readonly claimsByToken = new Map<string, ParticipantTokenClaims>();

  issueToken(sessionId: string, participantId: string): string {
    const now = Date.now();
    this.removeExpiredTokens(now);

    let accessToken: string;
    do {
      accessToken = randomBytes(32).toString('base64url');
    } while (this.claimsByToken.has(accessToken));

    this.claimsByToken.set(accessToken, {
      expiresAt: now + PARTICIPANT_TOKEN_TTL_MS,
      participantId,
      sessionId,
    });

    return accessToken;
  }

  verifyToken(accessToken: string): ParticipantTokenClaims {
    const claims = this.claimsByToken.get(accessToken);

    if (claims === undefined || claims.expiresAt <= Date.now()) {
      this.claimsByToken.delete(accessToken);
      throw new ApiHttpException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_TOKEN',
        'The participant token is invalid or expired.',
      );
    }

    return { ...claims };
  }

  revokeSession(sessionId: string): void {
    for (const [accessToken, claims] of this.claimsByToken.entries()) {
      if (claims.sessionId === sessionId) {
        this.claimsByToken.delete(accessToken);
      }
    }
  }

  clear(): void {
    this.claimsByToken.clear();
  }

  private removeExpiredTokens(now: number): void {
    for (const [accessToken, claims] of this.claimsByToken.entries()) {
      if (claims.expiresAt <= now) {
        this.claimsByToken.delete(accessToken);
      }
    }
  }
}
