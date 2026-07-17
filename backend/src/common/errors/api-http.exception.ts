import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiHttpException extends HttpException {
  constructor(statusCode: HttpStatus, code: string, message: string) {
    super({ code, message }, statusCode);
  }
}
