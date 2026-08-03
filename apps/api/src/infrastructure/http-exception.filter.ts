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

type ErrorPayload = {
  code: string;
  details?: unknown;
  fields?: Record<string, string>;
  message: string;
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
    const error = this.errorFor(exception, status);

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
      error,
      timestamp: new Date().toISOString(),
    });
  }

  private statusFor(exception: unknown): number {
    if (exception instanceof ApplicationError) return exception.statusCode;
    if (exception instanceof HttpException) return exception.getStatus();
    if (this.multerCode(exception) === 'LIMIT_FILE_SIZE') {
      return HttpStatus.PAYLOAD_TOO_LARGE;
    }
    if (this.multerCode(exception)) return HttpStatus.BAD_REQUEST;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private errorFor(exception: unknown, status: number): ErrorPayload {
    if (exception instanceof ApplicationError) {
      return { code: exception.code, message: exception.message };
    }
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') {
        return { code: 'request_failed', message: response };
      }
      if (typeof response === 'object' && response !== null) {
        const payload = response as {
          code?: unknown;
          details?: unknown;
          fields?: unknown;
          message?: unknown;
        };
        const rawMessage = payload.message;
        const message = Array.isArray(rawMessage)
          ? rawMessage.map(String).join(', ')
          : typeof rawMessage === 'string'
            ? rawMessage
            : exception.message;
        const fields =
          typeof payload.fields === 'object' &&
          payload.fields !== null &&
          !Array.isArray(payload.fields)
            ? (payload.fields as Record<string, string>)
            : undefined;
        return {
          code:
            typeof payload.code === 'string' ? payload.code : 'request_failed',
          message,
          ...(fields ? { fields } : {}),
          ...(payload.details === undefined
            ? {}
            : { details: payload.details }),
        };
      }
      return { code: 'request_failed', message: exception.message };
    }
    const multerCode = this.multerCode(exception);
    if (multerCode) {
      return multerCode === 'LIMIT_FILE_SIZE'
        ? {
            code: 'document_too_large',
            message: 'Document exceeds the upload size limit.',
          }
        : {
            code: 'invalid_multipart_upload',
            message: 'The multipart document upload is invalid.',
          };
    }
    return {
      code: 'request_failed',
      message:
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Internal server error'
          : 'Request failed',
    };
  }

  private multerCode(exception: unknown): string | undefined {
    if (!exception || typeof exception !== 'object') return undefined;
    const candidate = exception as { code?: unknown; name?: unknown };
    return candidate.name === 'MulterError' &&
      typeof candidate.code === 'string' &&
      candidate.code.startsWith('LIMIT_')
      ? candidate.code
      : undefined;
  }
}
