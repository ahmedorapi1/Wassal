export type AuditActor = {
  id: string;
  role: string;
  ipAddress?: string;
  userAgent?: string;
};

export type AuditRecord = {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId: string;
  before?: Readonly<Record<string, unknown>>;
  after?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, unknown>>;
};

export interface AuditWriter {
  write(record: AuditRecord): Promise<void>;
}
