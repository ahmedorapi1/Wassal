'use client';

import { useState } from 'react';

import { ZoneFinanceView } from './admin-operations-workspaces';
import { PhaseThreeFinance } from './phase-three-finance';

type Token = { accessToken: string };

export function AdminFinanceWorkspace({
  token,
  role,
}: {
  token: Token;
  role?: string;
}) {
  const [general, setGeneral] = useState(false);
  if (!['finance_admin', 'super_admin'].includes(role ?? '')) {
    return (
      <section className="admin-card finance-denied">
        <p className="kicker">صلاحيات منفصلة</p>
        <h2>مساحة المالية غير متاحة لهذا الدور</h2>
        <p>
          تعرض هذه الصفحة الأرصدة والتسويات حسب منطقة الخدمة، وهي متاحة لمسؤول
          المالية ومسؤول النظام الأعلى فقط.
        </p>
      </section>
    );
  }
  if (general) {
    return (
      <div className="operations-workspace">
        <button className="back" onClick={() => setGeneral(false)}>
          → العودة إلى المالية حسب المنطقة
        </button>
        <PhaseThreeFinance token={token} />
      </div>
    );
  }
  return (
    <ZoneFinanceView token={token} onOpenGeneral={() => setGeneral(true)} />
  );
}
