type AuthorizedDocument = {
  blob: Blob;
  contentType: string;
};

type DocumentFetcher = (input: string, init: RequestInit) => Promise<Response>;

export async function fetchAuthorizedCourierDocument(
  apiUrl: string,
  documentId: string,
  accessToken: string,
  fetcher: DocumentFetcher = (input, init) => fetch(input, init),
): Promise<AuthorizedDocument> {
  const response = await fetcher(
    `${apiUrl}/couriers/documents/${encodeURIComponent(documentId)}/file`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'غير مصرح بفتح هذا المستند.'
        : 'تعذر فتح المستند الآمن.',
    );
  }
  return {
    blob: await response.blob(),
    contentType:
      response.headers.get('content-type') ?? 'application/octet-stream',
  };
}
