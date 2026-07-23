import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ApplicationError } from '@wasel/observability';
import type { Logger } from 'pino';

type HttpResponse = {
  status(code: number): HttpResponse;
  json(body: unknown): void;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  public constructor(private readonly logger: Logger) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const request = host
      .switchToHttp()
      .getRequest<{ method: string; url: string }>();
    const status = this.statusFor(exception);
    const code =
      exception instanceof ApplicationError ? exception.code : 'request_failed';
    const message = this.messageFor(exception, status);

    this.logger.error(
      {
        err: exception,
        method: request.method,
        path: request.url,
        statusCode: status,
      },
      'HTTP request failed',
    );

    response.status(status).json({
      error: { code, message },
      timestamp: new Date().toISOString(),
    });
  }

  private statusFor(exception: unknown): number {
    if (exception instanceof ApplicationError) return exception.statusCode;
    if (exception instanceof HttpException) return exception.getStatus();
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private messageFor(exception: unknown, status: number): string {
    if (exception instanceof ApplicationError) return exception.message;
    if (exception instanceof HttpException) return exception.message;
    return status === HttpStatus.INTERNAL_SERVER_ERROR
      ? 'Internal server error'
      : 'Request failed';
  }
}
