import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('courier current-order presentation', () => {
  const source = readFileSync(
    new URL('./operational-app.tsx', import.meta.url),
    'utf8',
  );

  it('renders backend financial details without mixing item value into earnings', () => {
    expect(source).toContain('current.financialDetails.itemsSubtotalMinor');
    expect(source).toContain(
      'current.financialDetails.customerCollectAmountMinor',
    );
    expect(source).toContain('current.financialDetails.courierNetEarningMinor');
    expect(source).toContain(
      'current.financialDetails.platformCommissionMinor',
    );
    expect(source).toContain('قيمة الطلب');
    expect(source).toContain('المبلغ المطلوب تحصيله من العميل');
    expect(source).toContain('مستحق المندوب');
  });

  it('orders the main sections and keeps merchant notes separate', () => {
    const pickup = source.indexOf('بيانات الاستلام من التاجر');
    const dropoff = source.indexOf('بيانات التسليم للعميل');
    const contents = source.indexOf('محتوى الطلب');
    const finances = source.indexOf('التفاصيل المالية');
    const notes = source.indexOf('ملاحظات التاجر');
    const actions = source.indexOf('إجراءات التوصيل');

    expect(pickup).toBeGreaterThan(0);
    expect(pickup).toBeLessThan(dropoff);
    expect(dropoff).toBeLessThan(contents);
    expect(contents).toBeLessThan(finances);
    expect(finances).toBeLessThan(notes);
    expect(notes).toBeLessThan(actions);
  });

  it('opens status history in a dismissible modal and handles an empty history', () => {
    expect(source).toContain('visible={timelineVisible}');
    expect(source).toContain('setTimelineVisible(true)');
    expect(source).toContain('setTimelineVisible(false)');
    expect(source).toContain('من الأقدم إلى الأحدث');
    expect(source).toContain('لا توجد تحديثات للحالة حتى الآن.');
  });
});
