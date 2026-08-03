import { BadRequestException } from '@nestjs/common';
import { z } from '@wasel/validation';
import { describe, expect, it } from 'vitest';

import { parseInput } from './request';

describe('parseInput structured field validation', () => {
  it('returns canonical localized fields when a mapper is supplied', () => {
    try {
      parseInput(
        z.object({
          customer: z.object({ phone: z.string().regex(/^\+20\d+$/) }),
        }),
        { customer: { phone: 'invalid' } },
        {
          message: 'بيانات الطلب غير صحيحة.',
          fieldForIssue: (issue) =>
            issue.path.join('.') === 'customer.phone'
              ? {
                  field: 'customerPhone',
                  message: 'رقم الموبايل غير صحيح.',
                }
              : undefined,
        },
      );
      throw new Error('Expected validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'validation_failed',
        message: 'بيانات الطلب غير صحيحة.',
        fields: {
          customerPhone: 'رقم الموبايل غير صحيح.',
        },
      });
    }
  });
});
