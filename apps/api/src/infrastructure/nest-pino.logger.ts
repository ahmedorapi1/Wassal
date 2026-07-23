import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

export class NestPinoLogger implements LoggerService {
  public constructor(private readonly logger: Logger) {}

  public log(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.info({ optionalParameters }, this.asMessage(message));
  }

  public error(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.error({ optionalParameters }, this.asMessage(message));
  }

  public warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.warn({ optionalParameters }, this.asMessage(message));
  }

  public debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.debug({ optionalParameters }, this.asMessage(message));
  }

  public verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.trace({ optionalParameters }, this.asMessage(message));
  }

  private asMessage(message: unknown): string {
    return typeof message === 'string' ? message : JSON.stringify(message);
  }
}
