import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  I18nManager,
  NativeModules,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { brandColors } from '@wasel/ui/brand';

import { resolveCourierApiUrl } from './api-base-url';
import {
  appendReactNativeMultipart,
  stageAndroidDocument,
  type MultipartAppender,
} from './android-document-upload';
import { courierScreenForState } from './app-flow';
import skkaLogo from '../../logo.png';
import {
  asDocumentUploadError,
  DocumentUploadError,
  documentUploadErrorFromResponse,
  prepareDocumentAsset,
  type PreparedDocumentAsset,
} from './document-upload';
import {
  ApiRequestError,
  MobileSession,
  type MobileSessionTokens,
} from './mobile-session';
import { OperationalCourierApp } from './operational-app';

I18nManager.allowRTL(true);

const apiUrl = resolveCourierApiUrl(
  process.env.EXPO_PUBLIC_API_URL,
  (NativeModules.SourceCode as { scriptURL?: string } | undefined)?.scriptURL,
  Platform.OS,
);
const tokenKey = 'wassal.phase1.tokens';

type Tokens = MobileSessionTokens;
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

type DocumentStepType =
  | 'NATIONAL_ID_FRONT'
  | 'NATIONAL_ID_BACK'
  | 'DRIVER_LICENSE'
  | 'VEHICLE_LICENSE'
  | 'PROFILE_PHOTO';
type SelectedDocumentAsset = PreparedDocumentAsset & {
  picker: 'image' | 'pdf';
};
type SelectedDocuments = Partial<
  Record<DocumentStepType, SelectedDocumentAsset>
>;

const expoFileSystem = {
  cacheDirectory: Paths.cache.uri,
  copyAsync: async ({ from, to }: { from: string; to: string }) => {
    await new File(from).copy(new File(to), { overwrite: true });
  },
  getInfoAsync: async (uri: string) => {
    const file = new File(uri);
    return {
      exists: file.exists,
      isDirectory: false,
      size: file.size,
    };
  },
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
  accessToken?: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
  const body = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new ApiRequestError(
      body.error?.message ?? 'تعذر إتمام الطلب',
      response.status,
    );
  }
  return body;
}

export default function App() {
  const [tokens, setTokens] = useState<Tokens>();
  const [phone, setPhone] = useState('01001000011');
  const [password, setPassword] = useState('CourierDemo123');
  const [profile, setProfile] = useState<CourierProfile>();
  const [vehicle, setVehicle] = useState<Vehicle>();
  const [documents, setDocuments] = useState<CourierDocument[]>([]);
  const [verification, setVerification] = useState<Verification>();
  const [screen, setScreen] = useState<
    'auth' | 'profile' | 'vehicle' | 'documents' | 'review' | 'status'
  >('auth');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState<SelectedDocuments>(
    {},
  );
  const [uploadingDocumentType, setUploadingDocumentType] =
    useState<DocumentStepType>();
  const [session] = useState(
    () =>
      new MobileSession({
        storage: {
          load: () => SecureStore.getItemAsync(tokenKey),
          save: (value) => SecureStore.setItemAsync(tokenKey, value),
          clear: () => SecureStore.deleteItemAsync(tokenKey),
        },
        transport: api,
        onTokensChanged: setTokens,
      }),
  );

  const resetLocalState = useCallback(() => {
    setProfile(undefined);
    setVehicle(undefined);
    setDocuments([]);
    setSelectedDocuments({});
    setVerification(undefined);
    setMessage('');
    setScreen('auth');
  }, []);

  const hydrate = useCallback(async () => {
    try {
      const currentProfile =
        await session.request<CourierProfile>('/couriers/profile');
      setProfile(currentProfile);
      const [vehicleRows, documentRows, currentVerification] =
        await Promise.all([
          session.request<Vehicle[]>('/couriers/vehicles'),
          session.request<CourierDocument[]>('/couriers/documents'),
          session.request<Verification>('/couriers/verification-status'),
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
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        setScreen('profile');
        return;
      }
      if (error instanceof ApiRequestError && error.status === 401) {
        resetLocalState();
        return;
      }
      setMessage((error as Error).message);
    }
  }, [resetLocalState, session]);

  useEffect(() => {
    void (async () => {
      try {
        const restored = await session.restore();
        if (restored) await hydrate();
      } catch (error) {
        setMessage((error as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [hydrate, session]);

  async function login() {
    setLoading(true);
    try {
      const response = await api<{ tokens: Tokens }>('/auth/login', undefined, {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
      });
      await session.establish(response.tokens);
      await hydrate();
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
      const saved = await session.request<CourierProfile>('/couriers/profile', {
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
      const saved = await session.request<Vehicle>(
        vehicle ? `/couriers/vehicles/${vehicle.id}` : '/couriers/vehicles',
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

  async function selectDocument(
    type: DocumentStepType,
    source: 'image' | 'pdf',
  ) {
    if (!tokens) {
      setMessage(new DocumentUploadError('unauthorized').message);
      return;
    }

    let pickedAsset:
      | {
          uri: string;
          name?: string | null;
          mimeType?: string | null;
          size?: number | null;
        }
      | undefined;
    try {
      if (source === 'image') {
        const permission =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setMessage('يلزم السماح بالوصول للصور لاختيار ملف الهوية.');
          return;
        }
        const picked = await ImagePicker.launchImageLibraryAsync({
          allowsEditing: false,
          allowsMultipleSelection: false,
          mediaTypes: ['images'],
          quality: 1,
          selectionLimit: 1,
        });
        if (picked.canceled) return;
        const asset = picked.assets[0];
        if (asset) {
          pickedAsset = {
            uri: asset.uri,
            name: asset.fileName,
            mimeType: asset.mimeType,
            size: asset.fileSize,
          };
        }
      } else {
        const picked = await DocumentPicker.getDocumentAsync({
          // Ask the picker to copy while its Android provider permission is
          // active. stageAndroidDocument still handles a content:// fallback.
          copyToCacheDirectory: true,
          multiple: false,
          type: 'application/pdf',
        });
        if (picked.canceled) return;
        const asset = picked.assets[0];
        if (asset) {
          pickedAsset = {
            uri: asset.uri,
            name: asset.name,
            mimeType: asset.mimeType,
            size: asset.size,
          };
        }
      }
    } catch (error) {
      setMessage(asDocumentUploadError(error, 'unreadable').message);
      return;
    }

    if (!pickedAsset) {
      setMessage(new DocumentUploadError('unreadable').message);
      return;
    }

    try {
      const prepared = prepareDocumentAsset(pickedAsset);
      setSelectedDocuments((current) => ({
        ...current,
        [type]: { ...prepared, picker: source },
      }));
      setMessage(
        'تم اختيار الملف. راجع الاسم والنوع والحجم ثم اضغط رفع المستند.',
      );
    } catch (error) {
      setMessage(asDocumentUploadError(error, 'unreadable').message);
    }
  }

  async function uploadDocument(type: DocumentStepType) {
    if (!tokens) {
      setMessage(new DocumentUploadError('unauthorized').message);
      return;
    }
    const prepared = selectedDocuments[type];
    if (!prepared || uploadingDocumentType) return;

    setLoading(true);
    setUploadingDocumentType(type);
    setMessage('جارٍ رفع الملف...');
    let staged: Awaited<ReturnType<typeof stageAndroidDocument>> | undefined;
    try {
      staged = await stageAndroidDocument(
        prepared,
        expoFileSystem,
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      const uploadFile = staged;

      const current = documents.find(
        (document) =>
          document.type === type && document.status !== 'SUPERSEDED',
      );
      const path = current
        ? `/couriers/documents/${current.id}/replacement`
        : '/couriers/documents';
      const parameters: Record<string, string> = { type: String(type) };
      if (type === 'VEHICLE_LICENSE' && vehicle) {
        parameters.vehicleId = String(vehicle.id);
      }
      if (type !== 'PROFILE_PHOTO') {
        parameters.expiresAt = '2030-12-31';
      }

      if (__DEV__) {
        console.info('[courier-document-upload] multipart request', {
          url: `${apiUrl}${path}`,
          picker:
            prepared.picker === 'image'
              ? 'expo-image-picker'
              : 'expo-document-picker',
          sourceScheme: uploadFile.sourceScheme,
          transport: 'React Native fetch + FormData',
          fileField: 'file',
          file: {
            name: uploadFile.name,
            type: uploadFile.mimeType,
            size: uploadFile.size,
          },
          fields: parameters,
        });
      }

      const sendUpload = async (accessToken: string) => {
        const formData = new FormData();
        appendReactNativeMultipart(
          formData as unknown as MultipartAppender,
          parameters,
          uploadFile,
        );
        const response = await fetch(`${apiUrl}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: formData,
        });
        return {
          status: response.status,
          body: await response.text(),
        };
      };

      const activeTokens = session.currentTokens();
      if (!activeTokens) {
        throw new DocumentUploadError('unauthorized');
      }
      let response;
      try {
        response = await sendUpload(activeTokens.accessToken);
      } catch (error) {
        throw asDocumentUploadError(error, 'network');
      }

      if (response.status === 401) {
        let refreshedTokens: Tokens;
        try {
          refreshedTokens = await session.refreshAfterUnauthorized(
            activeTokens.accessToken,
          );
        } catch {
          throw new DocumentUploadError('unauthorized');
        }
        try {
          response = await sendUpload(refreshedTokens.accessToken);
        } catch (error) {
          throw asDocumentUploadError(error, 'network');
        }
      }

      if (__DEV__) {
        console.info('[courier-document-upload] response', {
          status: response.status,
          receivedMimeType: uploadFile.mimeType,
          sentBytes: uploadFile.size,
        });
      }
      if (response.status < 200 || response.status >= 300) {
        throw documentUploadErrorFromResponse(response.status, response.body);
      }

      const rows = await session.request<CourierDocument[]>(
        '/couriers/documents',
      );
      setDocuments(rows);
      setSelectedDocuments((currentSelections) => {
        const next = { ...currentSelections };
        delete next[type];
        return next;
      });
      setMessage('تم رفع المستند بنجاح.');
    } catch (error) {
      setMessage(asDocumentUploadError(error, 'server_rejection').message);
    } finally {
      if (staged?.cacheCopyCreated) {
        try {
          const cached = new File(staged.uri);
          if (cached.exists) cached.delete();
        } catch {
          // The private cache copy is best-effort cleanup and has no token.
        }
      }
      setUploadingDocumentType(undefined);
      setLoading(false);
    }
  }

  function removeSelectedDocument(type: DocumentStepType) {
    if (uploadingDocumentType) return;
    setSelectedDocuments((current) => {
      const next = { ...current };
      delete next[type];
      return next;
    });
    setMessage('تمت إزالة الملف المختار. يمكنك اختيار ملف آخر.');
  }

  async function submit() {
    if (!tokens) return;
    setLoading(true);
    try {
      await session.request('/couriers/submit-for-review', { method: 'POST' });
      const current = await session.request<Verification>(
        '/couriers/verification-status',
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
        await session.request('/auth/logout', { method: 'POST' });
      } catch {
        // Local credentials are still cleared if the API is unavailable.
      }
    }
    await session.clear();
    resetLocalState();
  }

  if (loading && screen === 'auth') {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={brandColors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (tokens && verification?.status === 'approved') {
    return <OperationalCourierApp session={session} onSignOut={signOut} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Image
            accessibilityLabel="شعار سِكّة"
            source={skkaLogo}
            style={styles.logo}
            resizeMode="contain"
          />
          <View style={styles.headerCopy}>
            <Text style={styles.brand}>سِكّة للمندوبين</Text>
            <Text style={styles.phase}>المرحلة الثانية · ملف التحقق</Text>
          </View>
          {tokens && (
            <Pressable
              onPress={signOut}
              accessibilityRole="button"
              style={styles.signOutAction}
            >
              <Text style={styles.signOut}>خروج</Text>
            </Pressable>
          )}
        </View>

        {tokens && !['status'].includes(screen) && (
          <Progress current={screen} />
        )}

        {screen === 'auth' && (
          <AuthCard
            phone={phone}
            setPhone={setPhone}
            password={password}
            setPassword={setPassword}
            onSubmit={login}
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
            selectedDocuments={selectedDocuments}
            uploadingType={uploadingDocumentType}
            onRemove={removeSelectedDocument}
            onSelect={selectDocument}
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
            <Text style={styles.busyText}>
              {uploadingDocumentType ? 'جارٍ رفع الملف...' : 'جارٍ الحفظ…'}
            </Text>
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
  password,
  setPassword,
  onSubmit,
}: {
  phone: string;
  setPhone: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.heroCard}>
      <Image
        accessibilityLabel="شعار سِكّة"
        resizeMode="contain"
        source={skkaLogo}
        style={styles.onboardingIllustration}
      />
      <Text style={[styles.overline, styles.heroOverline]}>
        ابدأ مشوارك مع سِكّة
      </Text>
      <Text style={styles.heroSlogan}>كل طلب له سكة</Text>
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
      <Field
        label="كلمة المرور"
        value={password}
        onChange={setPassword}
        secureTextEntry
      />
      <PrimaryButton label="دخول حساب المندوب" onPress={onSubmit} />
      <Text style={styles.privacy}>
        لا تستخدم المنصة SMS أو OTP في التشغيل التجريبي المضبوط. الخصوصية
        والشروط متاحتان من شاشة حول التطبيق.
      </Text>
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
  selectedDocuments,
  uploadingType,
  onRemove,
  onSelect,
  onUpload,
  onContinue,
}: {
  documents: CourierDocument[];
  selectedDocuments: SelectedDocuments;
  uploadingType?: DocumentStepType;
  onRemove: (type: DocumentStepType) => void;
  onSelect: (type: DocumentStepType, source: 'image' | 'pdf') => void;
  onUpload: (type: DocumentStepType) => void;
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
        {current.map(({ type, label, document }) => {
          const selected = selectedDocuments[type];
          const uploading = uploadingType === type;
          return (
            <View key={type} style={styles.documentBlock}>
              <View style={styles.documentRow}>
                <View
                  style={[
                    styles.documentIcon,
                    document && styles.documentIconDone,
                  ]}
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
                        : 'اختر صورة JPG/PNG أو ملف PDF'}
                  </Text>
                </View>
                <View style={styles.uploadChoices}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={Boolean(uploadingType)}
                    onPress={() => onSelect(type, 'image')}
                    style={[
                      styles.uploadChoice,
                      uploadingType && styles.uploadChoiceDisabled,
                    ]}
                  >
                    <Text style={styles.uploadChoiceText}>صورة</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={Boolean(uploadingType)}
                    onPress={() => onSelect(type, 'pdf')}
                    style={[
                      styles.uploadChoice,
                      uploadingType && styles.uploadChoiceDisabled,
                    ]}
                  >
                    <Text style={styles.uploadChoiceText}>PDF</Text>
                  </Pressable>
                </View>
              </View>
              {selected ? (
                <View style={styles.selectedFile}>
                  <View style={styles.selectedFileCopy}>
                    <Text style={styles.selectedFileName}>{selected.name}</Text>
                    <Text style={styles.selectedFileMeta}>
                      {selected.mimeType} · {formatFileSize(selected.size)}
                    </Text>
                  </View>
                  <View style={styles.selectedFileActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={Boolean(uploadingType)}
                      onPress={() => onRemove(type)}
                      style={styles.removeFileAction}
                    >
                      <Text style={styles.removeFileText}>إزالة</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={Boolean(uploadingType)}
                      onPress={() => onUpload(type)}
                      style={styles.sendFileAction}
                    >
                      <Text style={styles.sendFileText}>
                        {uploading ? 'جارٍ الرفع...' : 'رفع المستند'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      <PrimaryButton
        label="مراجعة الطلب"
        disabled={
          Boolean(uploadingType) || current.some((row) => !row.document)
        }
        onPress={onContinue}
      />
    </View>
  );
}

function formatFileSize(size: number | undefined): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    return 'الحجم سيُتحقق منه قبل الرفع';
  }
  if (size < 1_024) return `${size} بايت`;
  return `${(size / 1_048_576).toFixed(2)} ميجابايت`;
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
        body: 'ملفك مكتمل وصالح. حالة الاتصال وعروض التوصيل غير مفعلة حتى الآن.',
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
        المرحلة الثانية تتوقف عند إنشاء طلب المتجر والبحث عن مندوب. لا تتوفر
        حالة الاتصال أو عروض التوصيل في تطبيق المندوب حتى الآن.
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
  secureTextEntry = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
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
  safeArea: { backgroundColor: brandColors.background, flex: 1 },
  loading: {
    alignItems: 'center',
    backgroundColor: brandColors.background,
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
    justifyContent: 'center',
    marginBottom: 24,
    minHeight: 140,
    position: 'relative',
  },
  logo: {
    alignSelf: 'center',
    height: 86,
    width: 112,
  },
  headerCopy: { alignItems: 'center', marginTop: 4 },
  brand: {
    color: brandColors.primary,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  phase: {
    color: brandColors.textMuted,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
  signOut: {
    color: brandColors.danger,
    fontWeight: '700',
  },
  signOutAction: {
    position: 'absolute',
    right: 0,
    top: 8,
  },
  heroCard: {
    backgroundColor: brandColors.primaryDark,
    borderRadius: 24,
    padding: 24,
  },
  onboardingIllustration: {
    alignSelf: 'center',
    height: 110,
    marginBottom: 4,
    width: 230,
  },
  card: {
    backgroundColor: brandColors.surface,
    borderColor: brandColors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
  },
  overline: {
    color: brandColors.accentText,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 8,
    textAlign: 'right',
  },
  heroOverline: { color: brandColors.accent },
  heroSlogan: {
    color: brandColors.accent,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 8,
    textAlign: 'center',
  },
  heroTitle: {
    color: brandColors.surface,
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 44,
    textAlign: 'right',
  },
  title: {
    color: brandColors.text,
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 38,
    textAlign: 'right',
  },
  heroBody: {
    color: '#d9e4f7',
    fontSize: 15,
    lineHeight: 25,
    marginBottom: 12,
    marginTop: 10,
    textAlign: 'right',
  },
  body: {
    color: brandColors.textMuted,
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
    backgroundColor: brandColors.surface,
    borderColor: brandColors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: brandColors.text,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: brandColors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 52,
  },
  primaryDisabled: { backgroundColor: '#aebdb9' },
  primaryLabel: {
    color: brandColors.surface,
    fontSize: 15,
    fontWeight: '900',
  },
  privacy: {
    color: '#8ca6a3',
    fontSize: 11,
    marginTop: 12,
    textAlign: 'center',
  },
  link: {
    color: brandColors.primary,
    fontWeight: '800',
    marginTop: 16,
    textAlign: 'center',
  },
  infoStrip: {
    backgroundColor: '#eaf0fb',
    borderRadius: 12,
    marginTop: 14,
    padding: 13,
  },
  infoText: {
    color: brandColors.primaryDark,
    lineHeight: 21,
    textAlign: 'right',
  },
  documentList: { marginTop: 10 },
  documentBlock: {
    borderBottomColor: brandColors.border,
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
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
  documentIconText: {
    color: brandColors.primary,
    fontSize: 20,
    fontWeight: '900',
  },
  documentCopy: { flex: 1, marginHorizontal: 12 },
  documentLabel: { color: '#172c30', fontWeight: '800', textAlign: 'right' },
  documentStatus: {
    color: '#738287',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'right',
  },
  documentWarning: { color: '#9a5617' },
  uploadChoices: { gap: 6 },
  uploadChoice: {
    alignItems: 'center',
    backgroundColor: '#e7f2ef',
    borderRadius: 8,
    minWidth: 54,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  uploadChoiceText: {
    color: brandColors.primary,
    fontSize: 11,
    fontWeight: '900',
  },
  uploadChoiceDisabled: { opacity: 0.45 },
  selectedFile: {
    backgroundColor: '#f5f8fd',
    borderColor: brandColors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    marginTop: 8,
    padding: 10,
  },
  selectedFileCopy: { gap: 3 },
  selectedFileName: {
    color: brandColors.text,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'right',
  },
  selectedFileMeta: {
    color: brandColors.textMuted,
    fontSize: 11,
    textAlign: 'right',
  },
  selectedFileActions: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  removeFileAction: {
    alignItems: 'center',
    borderColor: brandColors.danger,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 9,
  },
  removeFileText: { color: brandColors.danger, fontWeight: '800' },
  sendFileAction: {
    alignItems: 'center',
    backgroundColor: brandColors.primary,
    borderRadius: 8,
    flex: 2,
    padding: 9,
  },
  sendFileText: { color: '#fff', fontWeight: '900' },
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
    backgroundColor: brandColors.surface,
    borderColor: brandColors.border,
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
  statusIconText: {
    color: brandColors.primary,
    fontSize: 34,
    fontWeight: '900',
  },
  statusTitle: {
    color: brandColors.text,
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
  miniStatusValue: {
    color: brandColors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
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
  progressDotActive: { backgroundColor: brandColors.primary },
  progressDotText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  progressLine: { backgroundColor: '#d8e0de', flex: 1, height: 2 },
  progressLineActive: { backgroundColor: brandColors.accent },
  busy: {
    alignItems: 'center',
    backgroundColor: brandColors.primaryDark,
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
