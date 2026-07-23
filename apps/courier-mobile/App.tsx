import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  I18nManager,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { courierScreenForState } from './app-flow';

I18nManager.allowRTL(true);

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
const tokenKey = 'wasel.phase1.tokens';

type Tokens = {
  accessToken: string;
  refreshToken: string;
};
type CourierProfile = {
  id: string;
  fullName: string;
  preferredCity: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  verificationStatus: string;
  version: number;
};
type Vehicle = {
  id: string;
  plateNumber: string;
  manufacturer: string | null;
  model: string | null;
  color: string | null;
  version: number;
};
type CourierDocument = {
  id: string;
  type: string;
  status: string;
  originalFilename: string;
  reviewNotes: string | null;
};
type Verification = {
  status: string;
  reason: string | null;
  eligibility: { eligible: boolean; reasons: string[] };
};

const documentSteps = [
  { type: 'NATIONAL_ID_FRONT', label: 'الوجه الأمامي للبطاقة' },
  { type: 'NATIONAL_ID_BACK', label: 'الوجه الخلفي للبطاقة' },
  { type: 'DRIVER_LICENSE', label: 'رخصة القيادة' },
  { type: 'VEHICLE_LICENSE', label: 'رخصة المركبة' },
  { type: 'PROFILE_PHOTO', label: 'الصورة الشخصية' },
] as const;

async function api<T>(
  path: string,
  tokens?: Tokens,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
      ...options.headers,
    },
  });
  const body = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? 'تعذر إتمام الطلب');
  }
  return body;
}

export default function App() {
  const [tokens, setTokens] = useState<Tokens>();
  const [phone, setPhone] = useState('01001000011');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('123456');
  const [profile, setProfile] = useState<CourierProfile>();
  const [vehicle, setVehicle] = useState<Vehicle>();
  const [documents, setDocuments] = useState<CourierDocument[]>([]);
  const [verification, setVerification] = useState<Verification>();
  const [screen, setScreen] = useState<
    'auth' | 'otp' | 'profile' | 'vehicle' | 'documents' | 'review' | 'status'
  >('auth');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void SecureStore.getItemAsync(tokenKey).then(async (stored) => {
      if (stored) {
        const restored = JSON.parse(stored) as Tokens;
        setTokens(restored);
        await hydrate(restored);
      }
      setLoading(false);
    });
  }, []);

  async function hydrate(activeTokens: Tokens) {
    try {
      const currentProfile = await api<CourierProfile>(
        '/couriers/profile',
        activeTokens,
      );
      setProfile(currentProfile);
      const [vehicleRows, documentRows, currentVerification] =
        await Promise.all([
          api<Vehicle[]>('/couriers/vehicles', activeTokens),
          api<CourierDocument[]>('/couriers/documents', activeTokens),
          api<Verification>('/couriers/verification-status', activeTokens),
        ]);
      setVehicle(vehicleRows.find((row) => row.id));
      setDocuments(documentRows);
      setVerification(currentVerification);
      setScreen(
        courierScreenForState({
          status: currentVerification.status,
          vehicleCount: vehicleRows.length,
          documentCount: documentRows.length,
          requiredDocumentCount: documentSteps.length,
        }),
      );
    } catch {
      setScreen('profile');
    }
  }

  async function requestOtp() {
    setLoading(true);
    setMessage('');
    try {
      const response = await api<{ challengeId: string }>(
        '/auth/request-otp',
        undefined,
        { method: 'POST', body: JSON.stringify({ phone }) },
      );
      setChallengeId(response.challengeId);
      setScreen('otp');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setLoading(true);
    try {
      const response = await api<{ tokens: Tokens }>(
        '/auth/verify-otp',
        undefined,
        {
          method: 'POST',
          body: JSON.stringify({
            challengeId,
            code: otp,
            registrationRole: 'courier',
          }),
        },
      );
      setTokens(response.tokens);
      await SecureStore.setItemAsync(tokenKey, JSON.stringify(response.tokens));
      await hydrate(response.tokens);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile(input: {
    fullName: string;
    preferredCity: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
  }) {
    if (!tokens) return;
    setLoading(true);
    try {
      const saved = await api<CourierProfile>('/couriers/profile', tokens, {
        method: profile ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...input,
          ...(profile ? { version: profile.version } : {}),
        }),
      });
      setProfile(saved);
      setScreen('vehicle');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveVehicle(input: {
    plateNumber: string;
    manufacturer: string;
    model: string;
    color: string;
  }) {
    if (!tokens) return;
    setLoading(true);
    try {
      const saved = await api<Vehicle>(
        vehicle ? `/couriers/vehicles/${vehicle.id}` : '/couriers/vehicles',
        tokens,
        {
          method: vehicle ? 'PATCH' : 'POST',
          body: JSON.stringify({
            ...input,
            ...(vehicle ? { version: vehicle.version } : {}),
          }),
        },
      );
      setVehicle(saved);
      setScreen('documents');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function uploadDocument(type: (typeof documentSteps)[number]['type']) {
    if (!tokens) return;
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: ['image/jpeg', 'image/png', 'application/pdf'],
    });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset) return;
    const form = new FormData();
    form.append('type', type);
    if (type === 'VEHICLE_LICENSE' && vehicle) {
      form.append('vehicleId', vehicle.id);
    }
    if (type !== 'PROFILE_PHOTO') {
      form.append('expiresAt', '2030-12-31');
    }
    form.append('file', {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? 'application/pdf',
    } as unknown as Blob);
    setLoading(true);
    try {
      const current = documents.find(
        (document) =>
          document.type === type && document.status !== 'SUPERSEDED',
      );
      const path = current
        ? `/couriers/documents/${current.id}/replacement`
        : '/couriers/documents';
      await api(path, tokens, { method: 'POST', body: form });
      const rows = await api<CourierDocument[]>('/couriers/documents', tokens);
      setDocuments(rows);
      setMessage('تم رفع الملف وحفظ نسخته بأمان.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!tokens) return;
    setLoading(true);
    try {
      await api('/couriers/submit-for-review', tokens, { method: 'POST' });
      const current = await api<Verification>(
        '/couriers/verification-status',
        tokens,
      );
      setVerification(current);
      setScreen('status');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    if (tokens) {
      try {
        await api('/auth/logout', tokens, { method: 'POST' });
      } catch {
        // Local credentials are still cleared if the API is unavailable.
      }
    }
    await SecureStore.deleteItemAsync(tokenKey);
    setTokens(undefined);
    setProfile(undefined);
    setScreen('auth');
  }

  if (loading && screen === 'auth') {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color="#087e73" size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>و</Text>
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.brand}>واصل للمندوبين</Text>
            <Text style={styles.phase}>المرحلة الأولى · ملف التحقق</Text>
          </View>
          {tokens && (
            <Pressable onPress={signOut} accessibilityRole="button">
              <Text style={styles.signOut}>خروج</Text>
            </Pressable>
          )}
        </View>

        {tokens && !['status'].includes(screen) && (
          <Progress current={screen} />
        )}

        {screen === 'auth' && (
          <AuthCard phone={phone} setPhone={setPhone} onSubmit={requestOtp} />
        )}
        {screen === 'otp' && (
          <OtpCard
            phone={phone}
            code={otp}
            setCode={setOtp}
            onSubmit={verifyOtp}
            onBack={() => setScreen('auth')}
          />
        )}
        {screen === 'profile' && (
          <ProfileCard profile={profile} onSubmit={saveProfile} />
        )}
        {screen === 'vehicle' && (
          <VehicleCard
            profile={profile}
            vehicle={vehicle}
            onSubmit={saveVehicle}
          />
        )}
        {screen === 'documents' && (
          <DocumentsCard
            documents={documents}
            onUpload={uploadDocument}
            onContinue={() => setScreen('review')}
          />
        )}
        {screen === 'review' && (
          <ReviewCard
            profile={profile}
            vehicle={vehicle}
            documents={documents}
            onEdit={(next) => setScreen(next)}
            onSubmit={submit}
          />
        )}
        {screen === 'status' && (
          <StatusCard
            verification={verification}
            documents={documents}
            onFix={() => setScreen('documents')}
          />
        )}

        {loading && (
          <View style={styles.busy}>
            <ActivityIndicator color="#ffffff" />
            <Text style={styles.busyText}>جارٍ الحفظ…</Text>
          </View>
        )}
        {message && <Text style={styles.message}>{message}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function AuthCard({
  phone,
  setPhone,
  onSubmit,
}: {
  phone: string;
  setPhone: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.heroCard}>
      <Text style={styles.overline}>ابدأ مشوارك مع واصل</Text>
      <Text style={styles.heroTitle}>خطوة واحدة نحو حساب مندوب موثق.</Text>
      <Text style={styles.heroBody}>
        سجّل برقم موبايل مصري، ثم أكمل بياناتك ومستنداتك للمراجعة.
      </Text>
      <Field
        label="رقم الموبايل"
        value={phone}
        onChange={setPhone}
        keyboardType="phone-pad"
      />
      <PrimaryButton label="إرسال رمز التحقق" onPress={onSubmit} />
      <Text style={styles.privacy}>
        لن نشارك رقمك. رمز التطوير المحلي هو 123456.
      </Text>
    </View>
  );
}

function OtpCard({
  phone,
  code,
  setCode,
  onSubmit,
  onBack,
}: {
  phone: string;
  code: string;
  setCode: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.overline}>تحقق آمن</Text>
      <Text style={styles.title}>أدخل الرمز المكوّن من ٦ أرقام</Text>
      <Text style={styles.body}>أُرسل الرمز إلى {phone}</Text>
      <Field
        label="رمز التحقق"
        value={code}
        onChange={setCode}
        keyboardType="number-pad"
      />
      <PrimaryButton label="تأكيد الرقم" onPress={onSubmit} />
      <Pressable onPress={onBack}>
        <Text style={styles.link}>تغيير رقم الموبايل</Text>
      </Pressable>
    </View>
  );
}

function ProfileCard({
  profile,
  onSubmit,
}: {
  profile?: CourierProfile;
  onSubmit: (input: {
    fullName: string;
    preferredCity: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
  }) => void;
}) {
  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [city, setCity] = useState(profile?.preferredCity ?? 'الجيزة');
  const [contact, setContact] = useState(profile?.emergencyContactName ?? '');
  const [contactPhone, setContactPhone] = useState(
    profile?.emergencyContactPhone ?? '',
  );
  return (
    <View style={styles.card}>
      <Text style={styles.overline}>بياناتك الشخصية</Text>
      <Text style={styles.title}>خلّينا نتعرف عليك</Text>
      <Text style={styles.body}>
        اكتب البيانات كما تظهر في مستنداتك الرسمية.
      </Text>
      <Field label="الاسم بالكامل" value={fullName} onChange={setFullName} />
      <Field label="مدينة العمل المفضلة" value={city} onChange={setCity} />
      <Field
        label="اسم جهة اتصال للطوارئ"
        value={contact}
        onChange={setContact}
      />
      <Field
        label="رقم جهة الاتصال"
        value={contactPhone}
        onChange={setContactPhone}
        keyboardType="phone-pad"
      />
      <PrimaryButton
        label="حفظ ومتابعة"
        disabled={!fullName || !contact || !contactPhone}
        onPress={() =>
          onSubmit({
            fullName,
            preferredCity: city,
            emergencyContactName: contact,
            emergencyContactPhone: contactPhone,
          })
        }
      />
    </View>
  );
}

function VehicleCard({
  profile,
  vehicle,
  onSubmit,
}: {
  profile?: CourierProfile;
  vehicle?: Vehicle;
  onSubmit: (input: {
    plateNumber: string;
    manufacturer: string;
    model: string;
    color: string;
  }) => void;
}) {
  const [plate, setPlate] = useState(vehicle?.plateNumber ?? '');
  const [manufacturer, setManufacturer] = useState(vehicle?.manufacturer ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [color, setColor] = useState(vehicle?.color ?? '');
  return (
    <View style={styles.card}>
      <Text style={styles.overline}>أهلاً {profile?.fullName ?? ''}</Text>
      <Text style={styles.title}>بيانات الدراجة النارية</Text>
      <Text style={styles.body}>المرحلة الأولى تدعم الدراجات النارية فقط.</Text>
      <View style={styles.infoStrip}>
        <Text style={styles.infoText}>نوع المركبة: دراجة نارية</Text>
      </View>
      <Field label="رقم اللوحة" value={plate} onChange={setPlate} />
      <Field
        label="الشركة المصنعة"
        value={manufacturer}
        onChange={setManufacturer}
      />
      <Field label="الموديل" value={model} onChange={setModel} />
      <Field label="اللون" value={color} onChange={setColor} />
      <PrimaryButton
        label="حفظ المركبة"
        disabled={!plate}
        onPress={() =>
          onSubmit({ plateNumber: plate, manufacturer, model, color })
        }
      />
    </View>
  );
}

function DocumentsCard({
  documents,
  onUpload,
  onContinue,
}: {
  documents: CourierDocument[];
  onUpload: (type: (typeof documentSteps)[number]['type']) => void;
  onContinue: () => void;
}) {
  const current = documentSteps.map((step) => ({
    ...step,
    document: documents.find(
      (row) => row.type === step.type && row.status !== 'SUPERSEDED',
    ),
  }));
  return (
    <View style={styles.card}>
      <Text style={styles.overline}>مستندات التحقق</Text>
      <Text style={styles.title}>ارفع صوراً واضحة وحديثة</Text>
      <Text style={styles.body}>نقبل JPG وPNG وPDF بحد أقصى ٥ ميجابايت.</Text>
      <View style={styles.documentList}>
        {current.map(({ type, label, document }) => (
          <Pressable
            key={type}
            style={styles.documentRow}
            onPress={() => onUpload(type)}
            accessibilityRole="button"
          >
            <View
              style={[styles.documentIcon, document && styles.documentIconDone]}
            >
              <Text style={styles.documentIconText}>
                {document ? '✓' : '+'}
              </Text>
            </View>
            <View style={styles.documentCopy}>
              <Text style={styles.documentLabel}>{label}</Text>
              <Text
                style={[
                  styles.documentStatus,
                  document?.status === 'CHANGES_REQUESTED' &&
                    styles.documentWarning,
                ]}
              >
                {document?.status === 'CHANGES_REQUESTED'
                  ? (document.reviewNotes ?? 'مطلوب الاستبدال')
                  : document
                    ? 'تم الرفع · اضغط للاستبدال'
                    : 'اضغط لاختيار ملف'}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      <PrimaryButton
        label="مراجعة الطلب"
        disabled={current.some((row) => !row.document)}
        onPress={onContinue}
      />
    </View>
  );
}

function ReviewCard({
  profile,
  vehicle,
  documents,
  onEdit,
  onSubmit,
}: {
  profile?: CourierProfile;
  vehicle?: Vehicle;
  documents: CourierDocument[];
  onEdit: (screen: 'profile' | 'vehicle' | 'documents') => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.overline}>المراجعة النهائية</Text>
      <Text style={styles.title}>تأكد أن كل شيء صحيح</Text>
      <SummaryRow
        label="البيانات الشخصية"
        value={profile?.fullName ?? '—'}
        onEdit={() => onEdit('profile')}
      />
      <SummaryRow
        label="المركبة"
        value={vehicle?.plateNumber ?? '—'}
        onEdit={() => onEdit('vehicle')}
      />
      <SummaryRow
        label="المستندات"
        value={`${documents.filter((row) => row.status !== 'SUPERSEDED').length} من ٥`}
        onEdit={() => onEdit('documents')}
      />
      <View style={styles.infoStrip}>
        <Text style={styles.infoText}>
          بعد الإرسال لن يمكنك تعديل البيانات حتى ينتهي فريق العمليات من
          المراجعة.
        </Text>
      </View>
      <PrimaryButton label="إرسال للمراجعة" onPress={onSubmit} />
    </View>
  );
}

function StatusCard({
  verification,
  documents,
  onFix,
}: {
  verification?: Verification;
  documents: CourierDocument[];
  onFix: () => void;
}) {
  const status = verification?.status ?? 'pending_review';
  const content: Record<string, { icon: string; title: string; body: string }> =
    {
      pending_review: {
        icon: '⏳',
        title: 'طلبك قيد المراجعة',
        body: 'سيُراجع فريق العمليات بياناتك ومستنداتك. ستظهر النتيجة هنا.',
      },
      approved: {
        icon: '✓',
        title: 'تم اعتماد حسابك',
        body: 'ملفك مكتمل وصالح. وضع الاتصال وطلبات التوصيل سيصلان في المرحلة الثانية.',
      },
      rejected: {
        icon: '×',
        title: 'لم يتم قبول الطلب',
        body: verification?.reason ?? 'راجع سبب القرار مع فريق الدعم.',
      },
      suspended: {
        icon: '!',
        title: 'الحساب موقوف',
        body: verification?.reason ?? 'تواصل مع فريق العمليات لمعرفة التفاصيل.',
      },
    };
  const view = content[status] ?? content.pending_review;
  return (
    <View style={styles.statusCard}>
      <View
        style={[
          styles.statusIcon,
          status === 'approved' && styles.statusIconApproved,
        ]}
      >
        <Text style={styles.statusIconText}>{view?.icon}</Text>
      </View>
      <Text style={styles.statusTitle}>{view?.title}</Text>
      <Text style={styles.statusBody}>{view?.body}</Text>
      {status === 'changes_requested' && (
        <PrimaryButton label="استبدال المستندات المطلوبة" onPress={onFix} />
      )}
      <View style={styles.statusList}>
        {documents
          .filter((row) => row.status !== 'SUPERSEDED')
          .map((document) => (
            <View style={styles.miniStatus} key={document.id}>
              <Text style={styles.miniStatusLabel}>
                {document.type.replaceAll('_', ' ')}
              </Text>
              <Text style={styles.miniStatusValue}>{document.status}</Text>
            </View>
          ))}
      </View>
      <Text style={styles.phaseNotice}>
        لا تتوفر حالة الاتصال أو عروض التوصيل في هذه المرحلة.
      </Text>
    </View>
  );
}

function Progress({ current }: { current: string }) {
  const steps = ['profile', 'vehicle', 'documents', 'review'];
  const currentIndex = Math.max(0, steps.indexOf(current));
  return (
    <View style={styles.progress}>
      {steps.map((step, index) => (
        <View key={step} style={styles.progressItem}>
          <View
            style={[
              styles.progressDot,
              index <= currentIndex && styles.progressDotActive,
            ]}
          >
            <Text style={styles.progressDotText}>{index + 1}</Text>
          </View>
          {index < steps.length - 1 && (
            <View
              style={[
                styles.progressLine,
                index < currentIndex && styles.progressLineActive,
              ]}
            />
          )}
        </View>
      ))}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        textAlign="right"
      />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.primaryButton, disabled && styles.primaryDisabled]}
    >
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <View style={styles.summaryRow}>
      <View>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
      <Pressable onPress={onEdit}>
        <Text style={styles.link}>تعديل</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#f3f6f4', flex: 1 },
  loading: {
    alignItems: 'center',
    backgroundColor: '#f3f6f4',
    flex: 1,
    justifyContent: 'center',
  },
  scrollContent: {
    alignSelf: 'center',
    maxWidth: 620,
    padding: 20,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    marginBottom: 24,
  },
  logo: {
    alignItems: 'center',
    backgroundColor: '#f1c75b',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  logoText: { color: '#112d31', fontSize: 24, fontWeight: '900' },
  headerCopy: { flex: 1, marginHorizontal: 10 },
  brand: {
    color: '#112d31',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'right',
  },
  phase: { color: '#6e7e82', fontSize: 11, marginTop: 2, textAlign: 'right' },
  signOut: { color: '#a13e30', fontWeight: '700' },
  heroCard: { backgroundColor: '#112d31', borderRadius: 24, padding: 24 },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#dce5e2',
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
  },
  overline: {
    color: '#159588',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 8,
    textAlign: 'right',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 44,
    textAlign: 'right',
  },
  title: {
    color: '#112d31',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 38,
    textAlign: 'right',
  },
  heroBody: {
    color: '#bfd3d0',
    fontSize: 15,
    lineHeight: 25,
    marginBottom: 12,
    marginTop: 10,
    textAlign: 'right',
  },
  body: {
    color: '#6b797e',
    fontSize: 15,
    lineHeight: 25,
    marginBottom: 12,
    marginTop: 7,
    textAlign: 'right',
  },
  field: { marginTop: 14 },
  label: {
    color: '#c7d7d4',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 7,
    textAlign: 'right',
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#cad7d4',
    borderRadius: 12,
    borderWidth: 1,
    color: '#112d31',
    minHeight: 50,
    paddingHorizontal: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#087e73',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 52,
  },
  primaryDisabled: { backgroundColor: '#aebdb9' },
  primaryLabel: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  privacy: {
    color: '#8ca6a3',
    fontSize: 11,
    marginTop: 12,
    textAlign: 'center',
  },
  link: {
    color: '#087e73',
    fontWeight: '800',
    marginTop: 16,
    textAlign: 'center',
  },
  infoStrip: {
    backgroundColor: '#e8f5f1',
    borderRadius: 12,
    marginTop: 14,
    padding: 13,
  },
  infoText: { color: '#17675f', lineHeight: 21, textAlign: 'right' },
  documentList: { marginTop: 10 },
  documentRow: {
    alignItems: 'center',
    borderBottomColor: '#e8edeb',
    borderBottomWidth: 1,
    flexDirection: 'row-reverse',
    paddingVertical: 14,
  },
  documentIcon: {
    alignItems: 'center',
    backgroundColor: '#edf1f0',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  documentIconDone: { backgroundColor: '#e3f4ed' },
  documentIconText: { color: '#087e73', fontSize: 20, fontWeight: '900' },
  documentCopy: { flex: 1, marginHorizontal: 12 },
  documentLabel: { color: '#172c30', fontWeight: '800', textAlign: 'right' },
  documentStatus: {
    color: '#738287',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'right',
  },
  documentWarning: { color: '#9a5617' },
  summaryRow: {
    alignItems: 'center',
    borderBottomColor: '#e6ecea',
    borderBottomWidth: 1,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  summaryLabel: { color: '#718085', fontSize: 12, textAlign: 'right' },
  summaryValue: {
    color: '#172c30',
    fontWeight: '800',
    marginTop: 4,
    textAlign: 'right',
  },
  statusCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dce5e2',
    borderRadius: 24,
    borderWidth: 1,
    padding: 26,
  },
  statusIcon: {
    alignItems: 'center',
    backgroundColor: '#fff2d9',
    borderRadius: 999,
    height: 82,
    justifyContent: 'center',
    width: 82,
  },
  statusIconApproved: { backgroundColor: '#e4f5ed' },
  statusIconText: { color: '#087e73', fontSize: 34, fontWeight: '900' },
  statusTitle: {
    color: '#112d31',
    fontSize: 28,
    fontWeight: '900',
    marginTop: 20,
    textAlign: 'center',
  },
  statusBody: {
    color: '#6e7e82',
    lineHeight: 25,
    marginTop: 10,
    textAlign: 'center',
  },
  statusList: { marginTop: 22, width: '100%' },
  miniStatus: {
    borderTopColor: '#e7ecea',
    borderTopWidth: 1,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingVertical: 11,
  },
  miniStatusLabel: { color: '#263b3f', fontSize: 12 },
  miniStatusValue: { color: '#087e73', fontSize: 11, fontWeight: '800' },
  phaseNotice: {
    backgroundColor: '#f1f3f2',
    borderRadius: 10,
    color: '#718085',
    fontSize: 11,
    marginTop: 18,
    padding: 11,
    textAlign: 'center',
    width: '100%',
  },
  progress: {
    flexDirection: 'row-reverse',
    marginBottom: 22,
    paddingHorizontal: 18,
  },
  progressItem: { alignItems: 'center', flex: 1, flexDirection: 'row-reverse' },
  progressDot: {
    alignItems: 'center',
    backgroundColor: '#d8e0de',
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  progressDotActive: { backgroundColor: '#087e73' },
  progressDotText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  progressLine: { backgroundColor: '#d8e0de', flex: 1, height: 2 },
  progressLineActive: { backgroundColor: '#087e73' },
  busy: {
    alignItems: 'center',
    backgroundColor: '#112d31',
    borderRadius: 12,
    flexDirection: 'row-reverse',
    justifyContent: 'center',
    marginTop: 12,
    padding: 12,
  },
  busyText: { color: '#ffffff', marginHorizontal: 8 },
  message: {
    backgroundColor: '#fff0df',
    borderRadius: 10,
    color: '#8e541a',
    lineHeight: 21,
    marginTop: 12,
    padding: 12,
    textAlign: 'right',
  },
});
