import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient, UserRole } from '@wasel/database';

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export async function merchantContext(
  database: DatabaseClient,
  userId: string,
) {
  const membership = await database.merchantMembership.findFirst({
    where: { userId, active: true, merchant: { status: 'ACTIVE' } },
    include: { merchant: true },
  });
  if (!membership) {
    throw new NotFoundException('An active merchant membership was not found.');
  }
  return membership;
}

export function requireMerchantRole(
  actual: UserRole,
  allowed: readonly UserRole[],
): void {
  if (!allowed.includes(actual)) {
    throw new ForbiddenException(
      'Your merchant role cannot perform this action.',
    );
  }
}
