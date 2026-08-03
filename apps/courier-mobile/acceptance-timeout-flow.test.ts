import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('courier acceptance timeout and merchant cancellation UI', () => {
  const source = readFileSync(
    new URL('./operational-app.tsx', import.meta.url),
    'utf8',
  );

  it('removes expired marketplace cards locally and rejects a late tap clearly', () => {
    expect(source).toContain('order.acceptanceExpiresAt !== null');
    expect(source).toContain(
      'new Date(order.acceptanceExpiresAt).getTime() > now',
    );
    expect(source).toContain('انتهت مدة قبول هذا الطلب.');
    expect(source).toContain("socket.on('marketplace.order.removed'");
  });

  it('shows the existing return route and preserved delivery value after pickup cancellation', () => {
    expect(source).toContain('current.cancelledAfterPickup');
    expect(source).toContain('التاجر ألغى الطلب بعد الاستلام');
    expect(source).toContain('ولا توجد رسوم');
    expect(source).toContain("RETURNING_TO_STORE: { path: 'returned'");
  });
});
