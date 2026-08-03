export const documentUploadMaxBytes = 5_242_880;

const acceptedMimeTypes = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
} as const;

type AcceptedMimeType = keyof typeof acceptedMimeTypes;

export type PickedDocumentAsset = {
  uri?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
};

export type PreparedDocumentAsset = {
  uri: string;
  name: string;
  mimeType: AcceptedMimeType;
  size?: number;
};

export type DocumentUploadErrorCode =
  | 'unsupported_type'
  | 'oversized'
  | 'unreadable'
  | 'network'
  | 'unauthorized'
  | 'server_rejection';

const errorMessages: Record<DocumentUploadErrorCode, string> = {
  unsupported_type: 'نوع الملف غير مدعوم. اختر ملف JPG أو PNG أو PDF.',
  oversized: 'حجم الملف أكبر من الحد المسموح وهو ٥ ميجابايت.',
  unreadable: 'تعذر قراءة الملف المختار. اختر الملف مرة أخرى وحاول مجددًا.',
  network: 'تعذر رفع الملف بسبب مشكلة في الشبكة. تحقق من الاتصال وحاول مجددًا.',
  unauthorized: 'انتهت جلسة الدخول. سجل الدخول مرة أخرى ثم أعد المحاولة.',
  server_rejection: 'رفض الخادم الملف. تحقق من الملف والبيانات ثم حاول مجددًا.',
};

export class DocumentUploadError extends Error {
  public constructor(
    public readonly code: DocumentUploadErrorCode,
    message = errorMessages[code],
  ) {
    super(message);
    this.name = 'DocumentUploadError';
  }
}

export function prepareDocumentAsset(
  asset: PickedDocumentAsset,
): PreparedDocumentAsset {
  const uri = asset.uri?.trim();
  if (!uri) throw new DocumentUploadError('unreadable');

  const pickerName = asset.name?.trim();
  const uriName = filenameFromUri(uri);
  const sourceName = pickerName || uriName;
  const pickerMimeType = asset.mimeType?.trim().toLowerCase();
  const normalizedPickerMime =
    pickerMimeType === 'image/jpg'
      ? 'image/jpeg'
      : pickerMimeType === 'application/octet-stream' ||
          pickerMimeType === 'binary/octet-stream'
        ? undefined
        : pickerMimeType;
  const extension = extensionFromName(sourceName);
  const extensionMimeType = mimeTypeFromExtension(extension);

  let mimeType: AcceptedMimeType | undefined;
  if (normalizedPickerMime) {
    if (!(normalizedPickerMime in acceptedMimeTypes)) {
      throw new DocumentUploadError('unsupported_type');
    }
    mimeType = normalizedPickerMime as AcceptedMimeType;
    if (extension && !extensionMimeType) {
      throw new DocumentUploadError('unsupported_type');
    }
    if (extensionMimeType && extensionMimeType !== mimeType) {
      throw new DocumentUploadError('unsupported_type');
    }
  } else {
    mimeType = extensionMimeType;
  }

  if (!mimeType) throw new DocumentUploadError('unsupported_type');

  if (
    typeof asset.size === 'number' &&
    Number.isFinite(asset.size) &&
    asset.size > documentUploadMaxBytes
  ) {
    throw new DocumentUploadError('oversized');
  }

  const canonicalExtension = acceptedMimeTypes[mimeType];
  const fallbackName = `courier-document${canonicalExtension}`;
  let name = sanitizeFilename(sourceName || fallbackName);
  if (!extensionFromName(name)) name += canonicalExtension;

  return {
    uri,
    name,
    mimeType,
    ...(typeof asset.size === 'number' &&
    Number.isFinite(asset.size) &&
    asset.size >= 0
      ? { size: asset.size }
      : {}),
  };
}

export function documentUploadErrorFromResponse(
  status: number,
  responseBody: string,
): DocumentUploadError {
  if (status === 401 || status === 403) {
    return new DocumentUploadError('unauthorized');
  }
  if (status === 413) return new DocumentUploadError('oversized');

  const serverMessage = parseServerMessage(responseBody);
  return new DocumentUploadError(
    'server_rejection',
    serverMessage
      ? `${errorMessages.server_rejection} (${serverMessage})`
      : errorMessages.server_rejection,
  );
}

export function asDocumentUploadError(
  error: unknown,
  fallback: DocumentUploadErrorCode,
): DocumentUploadError {
  return error instanceof DocumentUploadError
    ? error
    : new DocumentUploadError(fallback);
}

function filenameFromUri(uri: string): string {
  try {
    const withoutQuery = uri.split(/[?#]/u, 1)[0] ?? '';
    const encodedName = withoutQuery.split('/').pop() ?? '';
    return decodeURIComponent(encodedName);
  } catch {
    return '';
  }
}

function extensionFromName(name: string): string {
  const match = /(\.[^.]+)$/u.exec(name.trim());
  return match?.[1]?.toLowerCase() ?? '';
}

function mimeTypeFromExtension(
  extension: string,
): AcceptedMimeType | undefined {
  switch (extension) {
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.pdf':
      return 'application/pdf';
    default:
      return undefined;
  }
}

function sanitizeFilename(name: string): string {
  const sanitized = replaceControlCharacters(name.normalize('NFC'))
    .replaceAll(/[/\\<>:"|?*]/gu, '_')
    .trim()
    .replace(/[. ]+$/u, '')
    .slice(0, 180);
  return sanitized || 'courier-document';
}

function replaceControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? '_' : character;
    })
    .join('');
}

function parseServerMessage(responseBody: string): string | undefined {
  try {
    const body = JSON.parse(responseBody) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message = body.error?.message ?? body.message;
    return typeof message === 'string' && message.trim()
      ? message.trim().slice(0, 240)
      : undefined;
  } catch {
    return undefined;
  }
}
