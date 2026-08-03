import skkaLogo from '../../../../logo.png';

export default function TermsPage() {
  return (
    <main className="legal-page" dir="rtl">
      <div className="legal-logo-frame">
        <img src={skkaLogo.src} alt="شعار سِكّة" />
      </div>
      <p className="eyebrow">SKKA · سِكّة · مسودة للمراجعة القانونية</p>
      <h1>شروط الاستخدام / Terms of Use</h1>
      <p>يجب مراجعة هذه المسودة بواسطة محامٍ مصري مؤهل قبل الإطلاق العام.</p>
      <h2>دور المنصة ومسؤوليات المستخدمين</h2>
      <p>
        سِكّة نظام لتنسيق التوصيل والمحاسبة. يلتزم التاجر بدقة عنوان العميل
        وهاتفه ووصف الطلب وبمشروعية مشاركة بيانات العميل. يلتزم المندوب
        بالتعليمات، وحماية الطرد والبيانات، والإبلاغ الصادق عن الحالات.
      </p>
      <h2>التقديرات والتسليم</h2>
      <p>
        المسافة والمدة تقريبية ومحسوبة بلا اتصال وليستا ضماناً لمسافة الطريق.
        يمكن للتاجر الاعتراض خلال 24 ساعة من إبلاغ المندوب بالتسليم. التوقيع
        الورقي دليل خارجي اختياري؛ لا تخزن المنصة توقيعاً إلكترونياً أو صورة
        عميل أو OTP للتسليم.
      </p>
      <h2>الفشل والإرجاع</h2>
      <p>
        يجب تسجيل سبب فشل منظم. عند الإرجاع يبلغ المندوب بوصول الطرد، ثم يؤكد
        المالك أو المدير الاستلام، أو تنفذ الإدارة تجاوزاً مدققاً بعد المهلة.
      </p>
      <h2>العمولة والتسوية وإثبات الدفع</h2>
      <p>
        لا تثبت العمولة قبل انتهاء نافذة الاعتراض أو القرار الإداري. إثبات الدفع
        الخارجي لا يخفض رصيد المندوب حتى تعتمد إدارة المالية المبلغ، وقد تعتمد
        مبلغاً مختلفاً بسبب موثق. لا توجد بوابة دفع في هذا الإصدار.
      </p>
      <h2>التعليق والاستخدام المحظور والإنهاء</h2>
      <p>
        يمكن تعليق الحساب لحماية التشغيل أو عند المخالفة. يحظر الاحتيال، والمواد
        غير المشروعة، وإساءة استخدام بيانات العملاء أو المنصة. يمكن إنهاء الحساب
        مع حفظ السجلات الواجبة.
      </p>
      <h2>بنود تحتاج مراجعة قانونية</h2>
      <p>
        حدود المسؤولية: [صياغة قانونية مطلوبة] · القانون والاختصاص: [يحددان] ·
        التواصل: [بيانات الاتصال]. ستعلن التعديلات المستقبلية وتاريخ سريانها.
      </p>
      <hr />
      <p lang="en" dir="ltr">
        English summary: SKKA coordinates delivery and accounting. Merchants
        must provide accurate lawful order and customer data; couriers must
        report operational states honestly. Offline estimates are approximate.
        The merchant dispute window is 24 hours. Paper signatures are optional
        external evidence. Payment proofs affect balances only after finance
        approval. Suspension, prohibited use, termination, liability, governing
        law, contacts, and amendments require final legal review.
      </p>
    </main>
  );
}
