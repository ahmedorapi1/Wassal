import type { Prisma, UserRole } from '@wasel/database';

type AuditClient = {
  auditLog: {
    create(args: Prisma.AuditLogCreateArgs): Promise<unknown>;
  };
};

export async function writeAudit(
  database: AuditClient,
  input: {
    actorId?: string;
    actorRole?: UserRole;
    action: string;
    entityType: string;
    entityId: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<void> {
  await database.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.actorRole ? { actorRole: input.actorRole } : {}),
      ...(input.before ? { before: input.before } : {}),
      ...(input.after ? { after: input.after } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    },
  });
}
