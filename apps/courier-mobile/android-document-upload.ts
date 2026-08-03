import {
  DocumentUploadError,
  documentUploadMaxBytes,
  type PreparedDocumentAsset,
} from './document-upload';

export type StagedDocument = {
  cacheCopyCreated: boolean;
  uri: string;
  name: string;
  mimeType: PreparedDocumentAsset['mimeType'];
  size: number;
  sourceScheme: string;
};

type FileInfo = {
  exists: boolean;
  isDirectory?: boolean | null;
  size?: number;
};

type AndroidFileSystem = {
  cacheDirectory: string | null;
  copyAsync: (options: { from: string; to: string }) => Promise<void>;
  getInfoAsync: (uri: string) => Promise<FileInfo>;
};

export type ReactNativeFilePart = {
  uri: string;
  name: string;
  type: string;
};

export type MultipartAppender = {
  append: (name: string, value: string | ReactNativeFilePart) => void;
};

export function uriScheme(uri: string): string {
  return /^([a-z][a-z0-9+.-]*):/iu.exec(uri)?.[1]?.toLowerCase() ?? 'path';
}

export async function stageAndroidDocument(
  prepared: PreparedDocumentAsset,
  fileSystem: AndroidFileSystem,
  uniqueId: string,
): Promise<StagedDocument> {
  const sourceScheme = uriScheme(prepared.uri);
  const requiresCacheCopy = sourceScheme !== 'file';
  let uploadUri = prepared.uri;

  if (requiresCacheCopy) {
    if (!fileSystem.cacheDirectory) {
      throw new DocumentUploadError('unreadable');
    }
    uploadUri =
      `${fileSystem.cacheDirectory.replace(/\/?$/u, '/')}` +
      `skka-upload-${safeIdentifier(uniqueId)}${extensionForMime(prepared.mimeType)}`;
    try {
      // Android providers expose content:// handles with temporary read access.
      // Copy once into the app cache before React Native FormData reads it.
      await fileSystem.copyAsync({ from: prepared.uri, to: uploadUri });
    } catch {
      throw new DocumentUploadError('unreadable');
    }
  }

  let info: FileInfo;
  try {
    info = await fileSystem.getInfoAsync(uploadUri);
  } catch {
    throw new DocumentUploadError('unreadable');
  }
  if (
    !info.exists ||
    info.isDirectory === true ||
    typeof info.size !== 'number' ||
    !Number.isFinite(info.size) ||
    info.size <= 0
  ) {
    throw new DocumentUploadError('unreadable');
  }
  if (info.size > documentUploadMaxBytes) {
    throw new DocumentUploadError('oversized');
  }

  return {
    cacheCopyCreated: requiresCacheCopy,
    uri: uploadUri,
    name: prepared.name,
    mimeType: prepared.mimeType,
    size: info.size,
    sourceScheme,
  };
}

export function appendReactNativeMultipart(
  form: MultipartAppender,
  fields: Record<string, string>,
  file: StagedDocument,
): ReactNativeFilePart {
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  const part: ReactNativeFilePart = {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  };
  form.append('file', part);
  return part;
}

function extensionForMime(mimeType: PreparedDocumentAsset['mimeType']): string {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'application/pdf':
      return '.pdf';
  }
}

function safeIdentifier(value: string): string {
  return value.replaceAll(/[^a-z0-9-]/giu, '').slice(0, 80) || 'document';
}
