import { describe, expect, it, vi } from 'vitest';

import { fetchAuthorizedCourierDocument } from './private-document';

describe('authorized courier document viewer', () => {
  it('fetches private bytes with the admin bearer token and no cache', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(new Blob(['%PDF-1.4']), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    });

    const result = await fetchAuthorizedCourierDocument(
      'http://localhost:3100/api/v1',
      'document id',
      'admin-access-token',
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3100/api/v1/couriers/documents/document%20id/file',
      {
        headers: { Authorization: 'Bearer admin-access-token' },
        cache: 'no-store',
      },
    );
    expect(result.contentType).toBe('application/pdf');
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('does not expose private bytes after an authorization rejection', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 403 }));

    await expect(
      fetchAuthorizedCourierDocument(
        'http://localhost:3100/api/v1',
        'document-id',
        'merchant-token',
        fetcher,
      ),
    ).rejects.toThrow('غير مصرح');
  });
});
