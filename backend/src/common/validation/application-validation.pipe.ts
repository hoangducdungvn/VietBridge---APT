import { Injectable, ValidationPipe } from '@nestjs/common';

@Injectable()
export class ApplicationValidationPipe extends ValidationPipe {
  constructor() {
    super({
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      stopAtFirstError: false,
      transform: true,
      validationError: {
        target: false,
        value: false,
      },
      whitelist: true,
    });
  }
}
