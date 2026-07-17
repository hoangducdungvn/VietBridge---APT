import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiHttpException } from '../common/errors/api-http.exception';
import { InMemoryRateLimitService } from '../common/rate-limit/in-memory-rate-limit.service';

const SESSION_MUTATION_LIMIT = 20;
const SESSION_MUTATION_WINDOW_MS = 60_000;

@Injectable()
export class SessionMutationRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimitService: InMemoryRateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const clientAddress =
      request.ip || request.socket.remoteAddress || 'unknown';
    const key = `${clientAddress}:${context.getHandler().name}`;
    const accepted = this.rateLimitService.consume(
      key,
      SESSION_MUTATION_LIMIT,
      SESSION_MUTATION_WINDOW_MS,
    );

    if (!accepted) {
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMIT_EXCEEDED',
        'Too many session requests. Please try again later.',
      );
    }

    return true;
  }
}
