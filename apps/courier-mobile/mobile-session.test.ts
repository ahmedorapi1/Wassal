import { describe, expect, it, vi } from 'vitest';

import {
  ApiRequestError,
  MobileSession,
  type MobileSessionTokens,
} from './mobile-session.js';

const initialTokens: MobileSessionTokens = {
  accessToken: 'access-one',
  refreshToken: 'refresh-one',
};
const rotatedTokens: MobileSessionTokens = {
  accessToken: 'access-two',
  refreshToken: 'refresh-two',
};

function fixture(
  transport: (
    path: string,
    accessToken: string | undefined,
    options?: RequestInit,
  ) => Promise<unknown>,
) {
  let stored: string | null = null;
  const storage = {
    load: vi.fn(async () => stored),
    save: vi.fn(async (value: string) => {
      stored = value;
    }),
    clear: vi.fn(async () => {
      stored = null;
    }),
  };
  const changed: Array<MobileSessionTokens | undefined> = [];
  const session = new MobileSession({
    storage,
    transport: transport as never,
    onTokensChanged: (tokens) => changed.push(tokens),
  });
  return { changed, session, storage };
}

describe('courier mobile session', () => {
  it('uses newly issued tokens for the first authenticated request', async () => {
    const transport = vi.fn(async () => ({ profile: true }));
    const { session } = fixture(transport);

    await session.establish(initialTokens);
    await session.request('/couriers/profile');

    expect(transport).toHaveBeenCalledWith(
      '/couriers/profile',
      initialTokens.accessToken,
      undefined,
    );
  });

  it('single-flights rotation and retries concurrent requests only once', async () => {
    let releaseRefresh!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const transport = vi.fn(
      async (path: string, accessToken: string | undefined) => {
        if (path === '/auth/refresh') {
          await refreshStarted;
          return { tokens: rotatedTokens };
        }
        if (accessToken === initialTokens.accessToken) {
          throw new ApiRequestError('expired', 401);
        }
        return { path };
      },
    );
    const { session } = fixture(transport);
    await session.establish(initialTokens);

    const first = session.request('/couriers/profile');
    const second = session.request('/couriers/documents');
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { path: '/couriers/profile' },
      { path: '/couriers/documents' },
    ]);
    expect(
      transport.mock.calls.filter(([path]) => path === '/auth/refresh'),
    ).toHaveLength(1);
  });

  it('does not enter a retry loop when the rotated access token is rejected', async () => {
    const transport = vi.fn(
      async (path: string, accessToken: string | undefined) => {
        if (path === '/auth/refresh') return { tokens: rotatedTokens };
        throw new ApiRequestError(`rejected ${accessToken}`, 401);
      },
    );
    const { session, storage } = fixture(transport);
    await session.establish(initialTokens);

    await expect(session.request('/couriers/profile')).rejects.toMatchObject({
      status: 401,
    });
    expect(
      transport.mock.calls.filter(([path]) => path === '/auth/refresh'),
    ).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(session.currentTokens()).toBeUndefined();
    expect(storage.clear).toHaveBeenCalledOnce();
  });

  it('clears invalid persisted credentials and all in-memory tokens', async () => {
    const transport = vi.fn();
    const { session, storage } = fixture(transport);
    storage.load.mockResolvedValueOnce('{"accessToken": "only-one"}');

    await expect(session.restore()).resolves.toBeUndefined();
    expect(session.currentTokens()).toBeUndefined();
    expect(storage.clear).toHaveBeenCalledOnce();
  });
});
