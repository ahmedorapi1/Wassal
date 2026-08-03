import skkaLogo from '../../../../logo.png';

export default function PrivacyPage() {
  return (
    <main className="legal-page" dir="rtl">
      <div className="legal-logo-frame">
        <img src={skkaLogo.src} alt="شعار سِكّة" />
      </div>
      <p className="eyebrow">SKKA · سِكّة · مسودة للمراجعة القانونية</p>
      <h1>سياسة الخصوصية / Privacy Policy</h1>
      <p>
        هذه مسودة تشغيلية وليست تأكيداً لامتثال قانوني. يجب مراجعتها بواسطة
        محامٍ مصري مؤهل قبل الإطلاق العام.
      </p>
      <h2>هوية المنصة والتواصل</h2>
      <p>
        الاسم القانوني: [اسم الشركة القانوني] · العنوان المسجل: [العنوان] ·
        مسؤول الخصوصية: [privacy@example.com] · الدعم: [support@example.com] ·
        تاريخ السريان: [يحدد بعد المراجعة].
      </p>
      <h2>البيانات التي نعالجها</h2>
      <p>
        بيانات حسابات التجار، وهوية المندوب ومستندات التحقق، وبيانات العملاء
        التي يدخلها التاجر (الاسم والهاتف والعنوان)، وسجل الطلب، والنشاط
        التشغيلي، والتسويات المالية، وصور ومراجع إثبات الدفع، واعتراضات التسليم،
        والإشعارات داخل التطبيق، وسجلات التدقيق.
      </p>
      <h2>الموقع</h2>
      <p>
        لا يوفر هذا الإصدار تتبعاً حياً للمندوب ولا يجمع GPS في الخلفية. تحفظ
        إحداثيات الاستلام والتسليم التي يدخلها التاجر لتنسيق الطلب فقط.
      </p>
      <h2>الغرض والوصول</h2>
      <p>
        تستخدم البيانات لتشغيل التوصيل، والتحقق، والدعم، وحسم الاعتراضات،
        والمحاسبة. يرى كل مستخدم الحد اللازم لدوره؛ مستندات المندوب وإثباتات
        الدفع ملفات خاصة لا تملك روابط عامة.
      </p>
      <h2>الاحتفاظ والحماية والحقوق</h2>
      <p>
        تحفظ سجلات الطلب والمحاسبة والتدقيق وفق متطلبات التشغيل والقانون بعد
        اعتمادها. تطبق صلاحيات محدودة، وتشفير النقل، وتخزين خاص ونسخ احتياطية.
        يمكن طلب الوصول أو التصحيح أو الحذف أو إغلاق الحساب عبر [جهة اتصال
        الخصوصية]، مع مراعاة السجلات التي يجب الاحتفاظ بها قانونياً أو مالياً.
      </p>
      <h2>الإفصاح والتحديثات</h2>
      <p>
        قد نفصح عن البيانات عند وجود التزام قانوني أو ضرورة سلامة موثقة. سنعلن
        تاريخ أي تحديث جوهري ونطلب الموافقة حيث يلزم بعد المراجعة القانونية.
      </p>
      <hr />
      <p lang="en" dir="ltr">
        English summary: SKKA processes merchant, courier-verification,
        merchant-entered customer delivery, order, settlement, payment-proof,
        dispute, notification, and audit data to operate the pilot. There is no
        live courier tracking or background GPS in this MVP. Access, retention,
        deletion requests, legal disclosures, controller identity, contacts, and
        the effective date require final Egyptian legal review.
      </p>
    </main>
  );
}
