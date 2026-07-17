import { Injectable } from '@nestjs/common';
import { HealthResponse } from './health.types';

@Injectable()
export class HealthService {
  getStatus(): HealthResponse {
    return {
      service: 'vietbridge-backend',
      status: 'ok',
    };
  }
}
