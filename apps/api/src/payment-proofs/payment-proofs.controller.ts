import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { SessionPrincipal } from '@wasel/contracts';
import {
  idempotencyHeaderSchema,
  paymentProofApprovalSchema,
  paymentProofMetadataSchema,
  paymentProofRejectionSchema,
  versionedOrderCommandSchema,
  z,
} from '@wasel/validation';
import type { Response } from 'express';

import { AuthGuard } from '../auth/auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { inlineContentDisposition } from '../courier/file-response.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { PaymentProofsService } from './payment-proofs.service.js';

@Controller()
@UseGuards(AuthGuard, PermissionsGuard)
export class PaymentProofsController {
  public constructor(
    @Inject(PaymentProofsService)
    private readonly proofs: PaymentProofsService,
  ) {}

  @Post('couriers/payment-proofs')
  @Permissions('payment_proof:create')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5_242_880, files: 1 } }),
  )
  public submit(
    @Principal() actor: SessionPrincipal,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.proofs.submit(
      actor.userId,
      parseInput(paymentProofMetadataSchema, body),
      file,
      parseInput(idempotencyHeaderSchema, key),
    );
  }

  @Get('couriers/payment-proofs')
  @Permissions('payment_proof:read_own')
  public courierList(@Principal() actor: SessionPrincipal) {
    return this.proofs.courierList(actor.userId);
  }

  @Get('couriers/payment-proofs/:proofId')
  @Permissions('payment_proof:read_own')
  public courierDetail(
    @Principal() actor: SessionPrincipal,
    @Param('proofId') proofId: string,
  ) {
    return this.proofs.courierDetail(actor.userId, proofId);
  }

  @Post('couriers/payment-proofs/:proofId/cancel')
  @Permissions('payment_proof:cancel')
  public cancel(
    @Principal() actor: SessionPrincipal,
    @Param('proofId') proofId: string,
    @Body() body: unknown,
  ) {
    return this.proofs.cancel(
      actor.userId,
      proofId,
      parseInput(versionedOrderCommandSchema, body).version,
    );
  }

  @Get('admin/payment-proofs')
  @Permissions('payment_proof:review')
  public adminList(@Query() query: unknown) {
    return this.proofs.adminList(
      parseInput(
        z.object({
          status: z
            .enum([
              'PENDING_CONFIRMATION',
              'APPROVED',
              'PARTIALLY_APPROVED',
              'REJECTED',
              'CANCELLED_BY_COURIER',
              'SUPERSEDED',
            ])
            .optional(),
          courierId: z.string().uuid().optional(),
        }),
        query,
      ),
    );
  }

  @Get('admin/payment-proofs/:proofId')
  @Permissions('payment_proof:review')
  public adminDetail(@Param('proofId') proofId: string) {
    return this.proofs.adminDetail(proofId);
  }

  @Post('admin/payment-proofs/:proofId/approve')
  @Permissions('payment_proof:approve')
  public approve(
    @Principal() actor: SessionPrincipal,
    @Param('proofId') proofId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.proofs.approve(
      actor as SessionPrincipal & { role: 'finance_admin' | 'super_admin' },
      proofId,
      parseInput(paymentProofApprovalSchema, body),
      parseInput(idempotencyHeaderSchema, key),
    );
  }

  @Post('admin/payment-proofs/:proofId/reject')
  @Permissions('payment_proof:reject')
  public reject(
    @Principal() actor: SessionPrincipal,
    @Param('proofId') proofId: string,
    @Body() body: unknown,
  ) {
    return this.proofs.reject(
      actor as SessionPrincipal & { role: 'finance_admin' | 'super_admin' },
      proofId,
      parseInput(paymentProofRejectionSchema, body),
    );
  }

  @Get('payment-proofs/:proofId/file')
  @Permissions('payment_proof_file:read')
  public async file(
    @Principal() actor: SessionPrincipal,
    @Param('proofId') proofId: string,
    @Res() response: Response,
  ) {
    const file = await this.proofs.file(actor, proofId);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader(
      'Content-Disposition',
      inlineContentDisposition(file.filename),
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Length', String(file.bytes.byteLength));
    response.send(Buffer.from(file.bytes));
  }
}
