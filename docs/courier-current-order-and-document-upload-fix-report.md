# تقرير إصلاح الطلب الحالي ورفع مستندات المندوب

## ملخص التنفيذ

تم ربط شاشة الطلب الحالي في تطبيق SKKA Courier بقيم مالية صريحة يعيدها
الـBackend، وإعادة ترتيب الشاشة إلى أقسام عربية واضحة، ونقل سجل الحالة إلى
Bottom Sheet قابل للفتح والإغلاق. كما تم إصلاح مسار اختيار وتهيئة ورفع مستندات
المندوب على Expo/Android مع إبقاء التخزين خاصًا والمراجعة الإدارية إلزامية.

لا توجد Migration أو تغييرات في نموذج قاعدة البيانات؛ جميع القيم المالية
المطلوبة كانت محفوظة بالفعل بوحدات القرش الصحيحة داخل `DeliveryOrder`.

## السبب الحقيقي لفشل رفع المستندات

المسار السابق كان يضبط `expo-document-picker` على
`copyToCacheDirectory: false`. في Android يعيد ذلك غالبًا URI مؤقتًا من نوع
`content://` يعتمد على صلاحية قراءة يمنحها مزود المستندات. بعد انتهاء الاختيار
كان التطبيق يحاول فتح URI ونسخه بواسطة واجهة `expo-file-system/legacy`، وكان
أي فشل Native في النسخ أو قراءة الحجم يتحول إلى خطأ `unreadable` قبل إنشاء
طلب HTTP. كما كان التطبيق يعيد نسخ أصول `file://` التي وضعها Image Picker
بالفعل في cache، مما أضاف نقطة فشل غير لازمة للصور.

## إصلاح مسار الرفع

- أصبح Document Picker يستخدم `copyToCacheDirectory: true` حتى يتم النسخ أثناء
  صلاحية إذن مزود Android.
- ملفات `file://` المقروءة تستخدم مباشرة بعد التحقق من وجودها وحجمها.
- بقي دعم `content://` كمسار احتياطي، ويستخدم واجهة `File` الحديثة في
  `expo-file-system` لنسخه إلى cache خاص بالتطبيق.
- يتحقق التطبيق من الحجم الفعلي بعد التهيئة، وليس من metadata الخاصة بالـpicker
  فقط.
- يدعم MIME والامتدادات JPG/JPEG وPNG وPDF، مع استنتاج النوع من الامتداد عندما
  يعيد Android `application/octet-stream`.
- ملف FormData هو كائن React Native بالشكل `{ uri, name, type }` واسم الحقل
  `file`.
- لا يضبط التطبيق `Content-Type: multipart/form-data` يدويًا؛ `fetch` يولد
  boundary الصحيح.
- يعاد إرسال الطلب مرة واحدة بعد تجديد الجلسة عند `401`، بدون تسجيل Access
  Token.
- أصبح التدفق: اختيار الملف، عرض الاسم والنوع والحجم، رفع صريح، منع الضغط
  المتكرر، إزالة/استبدال الاختيار، والاحتفاظ بالاختيار لإعادة المحاولة عند
  الفشل.
- حد الرفع هو 5,242,880 بايت. استجابة Multer لحجم أكبر تعرض في التطبيق رسالة
  الحجم العربية، والـAPI يعيد HTTP 413.

## التخزين والوصول الآمن

يستمر الـAPI في التحقق من توقيع البايتات الفعلي ومطابقته مع MIME قبل التخزين.
التخزين المحلي/S3 خاص، ولا يعاد `storageKey` إلى العميل. قراءة الملف تتم فقط من
خلال مسار مصادق عليه للمندوب صاحب الملف أو `operations_admin`/`super_admin`،
مع:

- `Cache-Control: private, no-store`
- `X-Content-Type-Options: nosniff`
- اسم ملف UTF-8 آمن
- `Content-Length` وMIME الصحيحين

نجاح الرفع لا يعتمد حساب المندوب تلقائيًا؛ المستند الجديد يبقى `PENDING` حتى
المراجعة الإدارية.

## القيم المالية وطريقة الحساب

الـBackend يعيد `financialDetails` على الطلب المعين:

- `itemsSubtotalMinor`: من `declaredValueMinor`، وهي قيمة الطلب/المنتجات.
- `deliveryFeeMinor`: من `merchantTotalMinor`، وهو سعر التوصيل المثبت في عرض
  السعر.
- `platformCommissionMinor`: عمولة المنصة المثبتة وقت التسعير.
- `courierNetEarningMinor`: القيمة المثبتة في
  `estimatedCourierEarningMinor`، وتساوي سعر التوصيل ناقص عمولة المنصة.
- `customerCollectAmountMinor`: في الوضع الحالي `DELIVERY_ONLY` يساوي سعر
  التوصيل فقط. الكود يدعم تمثيل COD مستقبلًا بقيمة الطلب + سعر التوصيل، لكن
  قاعدة البيانات وFeature Flag يبقيانه معطلًا في الـMVP الحالي.
- `merchantPaymentRequiredMinor`: صفر؛ النظام الحالي لا يطلب من المندوب تمويل
  قيمة المنتجات أو دفعها للتاجر عند الاستلام.
- `currency`: العملة المثبتة على الطلب.

كل الأرقام وحدات صحيحة (قرش) ويُرفض أي رقم مخزن سالب أو غير صحيح بدل تنفيذ
حساب Floating Point غير آمن في React Native.

في الاختبار الحي للطلب `WSL-260802-4D91955D32` أعاد الـAPI:

- قيمة الطلب: 10,000 قرش (100 جنيه).
- سعر التوصيل والتحصيل من العميل: 3,197 قرش (31.97 جنيه).
- عمولة المنصة: 480 قرش (4.80 جنيه).
- صافي المندوب: 2,717 قرش (27.17 جنيه).
- العلاقة: `3197 - 480 = 2717`، وقيمة المنتجات لا تدخل في صافي المندوب.

## تغييرات شاشة الطلب

ترتيب الشاشة الحالي:

1. حالة الطلب الحالية ورقم الطلب.
2. بيانات الاستلام والفرع واتجاهاته.
3. بيانات العميل والتسليم واتجاهاته.
4. محتوى الطلب وقيمته.
5. التفاصيل المالية والأرقام البارزة.
6. ملاحظات التاجر.
7. إجراءات دورة التوصيل.
8. بطاقة مختصرة لفتح سجل الحالة.

سجل الحالة لا يعرض كاملًا افتراضيًا. يفتح داخل Bottom Sheet مرتب من الأقدم إلى
الأحدث، ويمكن إغلاقه بزر أو زر الرجوع في Android، ويعرض رسالة قصيرة عند خلوه.

## متغيرات البيئة

لم تتم إضافة متغيرات جديدة. يستمر التطبيق في استخدام
`EXPO_PUBLIC_API_URL`. القيمة المحلية الحالية عنوان LAN وليست `localhost`،
ويقوم root script `pnpm -w run dev:courier` بتحميل `.env`.

## الاختبارات المنفذة

- الاختبارات المستهدفة: 40/40 ناجحة.
- Phase 1 + Phase 3 E2E: 19/19 ناجحة.
- المجموعة الكاملة: 62 ملفًا، 309/309 اختبارات ناجحة.
- `pnpm lint`: ناجح.
- `pnpm typecheck`: ناجح لكل الحزم الـ13.
- `pnpm build`: ناجح؛ API وWorker وAdmin وMerchant وCourier كلها نجحت.
- Expo Android export: ناجح، وتم إنشاء Android Hermes bundle داخل
  `apps/courier-mobile/dist`.
- Prettier لكل الملفات المعدلة: ناجح.
- `pnpm format:check` الشامل: توقف فقط بسبب ملف موجود مسبقًا وغير مرتبط
  `WASSAL_admin_operations_updates_1_to_4.md`، ولم يتم تعديله ضمن هذه المهمة.

## اختبار API الفعلي بملفات حقيقية

استخدم الاختبار الحي الحساب التجريبي `+201001000011`:

- تسجيل الدخول: ناجح.
- JPG فعلي: `android-real-photo.jpg`، MIME `image/jpeg`، الحجم 68,640 بايت،
  استجابة الرفع ناجحة والحالة `PENDING`.
- PDF فعلي: `android-real-license.pdf`، MIME `application/pdf`، الحجم 68
  بايت، استجابة الرفع ناجحة والحالة `PENDING`.
- مسؤول العمليات قرأ الملفين من المسار الخاص؛ HTTP 200، MIME والحجم مطابقان،
  و`private/no-store` و`nosniff` موجودان.
- القراءة بلا مصادقة: HTTP 401.
- ملف أكبر من 5MB: HTTP 413.
- اختبار Phase 1 E2E رفع وتحقق من بايتات JPG وPNG وPDF، ورفض ملف يحمل توقيعًا
  مخالفًا للـMIME.

## حدود اختبار Android

لم يتوفر Android Emulator أو ADB في بيئة التنفيذ، لذلك لم يتم الضغط البصري
على منتقي الملفات داخل Expo Go على جهاز حقيقي في هذه الجولة. تم بدلًا من ذلك
تشغيل اختبارات وحدات مسار `content://` و`file://` وFormData، ونجح Android
export، وتم اختبار الـAPI ببايتات فعلية. يلزم التحقق اليدوي الأخير على Expo Go
قبل وصف السلوك بأنه متحقق على جهاز Android فعلي.

## خطوات تحقق يدوية مختصرة

1. شغّل `pnpm -w run dev:courier` وتأكد أن الهاتف والكمبيوتر على شبكة واحدة.
2. افتح Expo Go وسجل بالحساب غير المكتمل `+201001000011` وكلمة المرور
   `CourierDemo123`.
3. اختر صورة JPG ثم تحقق من ظهور الاسم وMIME والحجم قبل الضغط على «رفع
   المستند».
4. ارفع الصورة وتأكد من رسالة «تم رفع المستند بنجاح.» وتحديث الحالة إلى
   `PENDING`.
5. كرر باستخدام PNG وPDF، ثم جرّب ملفًا أكبر من 5MB ونوعًا غير مدعوم.
6. سجل بحساب العمليات في Admin Web وافتح المستندات من شاشة المندوب وتحقق من
   عرضها عبر المسار المصادق عليه.
7. سجل بالحساب المعتمد `+201001000013`، وافتح «الحالي»، وتحقق من أقسام المحتوى
   والتفاصيل المالية ثم افتح وأغلق «سجل الحالة».

## الملفات المعدلة

- `apps/api/src/courier-orders/courier-order-presentation.ts`
- `apps/api/src/courier-orders/courier-order-presentation.test.ts`
- `apps/api/src/courier-orders/courier-orders.service.ts`
- `apps/api/src/phase-three.e2e.test.ts`
- `apps/api/src/infrastructure/http-exception.filter.ts`
- `apps/api/src/infrastructure/http-exception.filter.test.ts`
- `apps/courier-mobile/App.tsx`
- `apps/courier-mobile/operational-app.tsx`
- `apps/courier-mobile/android-document-upload.ts`
- `apps/courier-mobile/android-document-upload.test.ts`
- `apps/courier-mobile/document-upload.ts`
- `apps/courier-mobile/document-upload.test.ts`
- `apps/courier-mobile/current-order-presentation.test.ts`
- `apps/courier-mobile/document-upload-ui.test.ts`
- `docs/courier-current-order-and-document-upload-fix-report.md`
