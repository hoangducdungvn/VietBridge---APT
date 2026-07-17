import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { StructuredLogger } from '../../observability/structured-logger.service';
import { ApiErrorResponse } from '../errors/api-error-response.interface';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response<ApiErrorResponse>>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const details = extractDetails(exceptionResponse);
    const code = extractCode(exceptionResponse, statusCode, details);

    this.logger.error(
      {
        durationMs: null,
        errorCode: code,
        event: 'http.request.failed',
        exceptionType:
          exception instanceof Error ? exception.name : 'UnknownException',
        method: request.method,
        participantId: null,
        path: request.path,
        sessionId: null,
        status: 'error',
        statusCode,
        turnId: null,
      },
      GlobalExceptionFilter.name,
    );

    response.status(statusCode).json({
      code,
      ...(details.length > 0 ? { details } : {}),
      message: extractMessage(
        exception,
        exceptionResponse,
        statusCode,
        details,
      ),
      path: request.path,
      statusCode,
      timestamp: new Date().toISOString(),
    });
  }
}

function extractCode(
  exceptionResponse: unknown,
  statusCode: number,
  details: readonly string[],
): string {
  if (
    isRecord(exceptionResponse) &&
    typeof exceptionResponse.code === 'string'
  ) {
    return exceptionResponse.code;
  }

  if (details.length > 0) {
    return 'VALIDATION_ERROR';
  }

  if (statusCode >= 500) {
    return 'INTERNAL_ERROR';
  }

  const statusName = HttpStatus[statusCode];
  return typeof statusName === 'string' ? statusName : 'HTTP_ERROR';
}

function extractDetails(exceptionResponse: unknown): readonly string[] {
  if (
    !isRecord(exceptionResponse) ||
    !Array.isArray(exceptionResponse.message)
  ) {
    return [];
  }

  return exceptionResponse.message.filter(
    (message): message is string => typeof message === 'string',
  );
}

function extractMessage(
  exception: unknown,
  exceptionResponse: unknown,
  statusCode: number,
  details: readonly string[],
): string {
  if (statusCode >= 500) {
    return 'Internal server error.';
  }

  if (details.length > 0) {
    return 'Request validation failed.';
  }

  if (typeof exceptionResponse === 'string') {
    return exceptionResponse;
  }

  if (
    isRecord(exceptionResponse) &&
    typeof exceptionResponse.message === 'string'
  ) {
    return exceptionResponse.message;
  }

  return exception instanceof Error ? exception.message : 'Request failed.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
