import { ConsoleLogger, Injectable } from '@nestjs/common';

@Injectable()
export class StructuredLogger extends ConsoleLogger {
  constructor() {
    super('VietBridge', {
      colors: false,
      json: true,
    });
  }
}
