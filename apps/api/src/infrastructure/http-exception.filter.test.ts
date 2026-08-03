import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter structured validation responses', () => {
  it('preserves validation code, Arabic message, fields, and details', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const logger = { error: vi.fn() } as unknown as Logger;
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: '/api/v1/orders/quotes' }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;
    const exception = new BadRequestException({
      code: 'validation_failed',
      message: 'بيانات الطلب غير صحيحة.',
      fields: {
        customerPhone: 'رقم الموبايل غير صحيح.',
      },
      details: [{ path: ['customer', 'phone'], message: 'Invalid' }],
    });

    new HttpExceptionFilter(logger).catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'validation_failed',
          message: 'بيانات الطلب غير صحيحة.',
          fields: {
            customerPhone: 'رقم الموبايل غير صحيح.',
          },
          details: [{ path: ['customer', 'phone'], message: 'Invalid' }],
        },
      }),
    );
  });

  it('maps Multer file-size rejection to HTTP 413', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const logger = { error: vi.fn() } as unknown as Logger;
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/api/v1/couriers/documents',
        }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;
    const exception = Object.assign(new Error('File too large'), {
      code: 'LIMIT_FILE_SIZE',
      name: 'MulterError',
    });

    new HttpExceptionFilter(logger).catch(exception, host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'document_too_large',
          message: 'Document exceeds the upload size limit.',
        },
      }),
    );
  });
});
