export type MobileSessionTokens = {
  accessToken: string;
  refreshToken: string;
};

export class ApiRequestError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

type SessionStorage = {
  load: () => Promise<string | null>;
  save: (value: string) => Promise<void>;
  clear: () => Promise<void>;
};

type SessionTransport = <T>(
  path: string,
  accessToken: string | undefined,
  options?: RequestInit,
) => Promise<T>;

type MobileSessionOptions = {
  storage: SessionStorage;
  transport: SessionTransport;
  onTokensChanged?: (tokens: MobileSessionTokens | undefined) => void;
};

function parseStoredTokens(value: string): MobileSessionTokens | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<MobileSessionTokens>;
    if (
      typeof parsed.accessToken !== 'string' ||
      parsed.accessToken.length === 0 ||
      typeof parsed.refreshToken !== 'string' ||
      parsed.refreshToken.length === 0
    ) {
      return undefined;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
    };
  } catch {
    return undefined;
  }
}

export class MobileSession {
  private tokens: MobileSessionTokens | undefined;
  private refreshInFlight: Promise<MobileSessionTokens> | undefined;

  public constructor(private readonly options: MobileSessionOptions) {}

  public currentTokens(): MobileSessionTokens | undefined {
    return this.tokens;
  }

  public async restore(): Promise<MobileSessionTokens | undefined> {
    const stored = await this.options.storage.load();
    if (!stored) return undefined;
    const tokens = parseStoredTokens(stored);
    if (!tokens) {
      await this.clear();
      return undefined;
    }
    this.tokens = tokens;
    this.options.onTokensChanged?.(tokens);
    return tokens;
  }

  public async establish(tokens: MobileSessionTokens): Promise<void> {
    await this.options.storage.save(JSON.stringify(tokens));
    this.tokens = tokens;
    this.options.onTokensChanged?.(tokens);
  }

  public async clear(): Promise<void> {
    this.tokens = undefined;
    this.options.onTokensChanged?.(undefined);
    await this.options.storage.clear();
  }

  public async request<T>(path: string, options?: RequestInit): Promise<T> {
    const attemptedTokens = this.requireTokens();
    try {
      return await this.options.transport<T>(
        path,
        attemptedTokens.accessToken,
        options,
      );
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.status !== 401) {
        throw error;
      }
    }

    const refreshed = await this.refreshAfterUnauthorized(
      attemptedTokens.accessToken,
    );
    try {
      return await this.options.transport<T>(
        path,
        refreshed.accessToken,
        options,
      );
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        await this.clear();
      }
      throw error;
    }
  }

  public async refreshAfterUnauthorized(
    failedAccessToken: string,
  ): Promise<MobileSessionTokens> {
    const current = this.requireTokens();
    if (current.accessToken !== failedAccessToken) return current;
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.rotate(current).finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    return this.refreshInFlight;
  }

  private requireTokens(): MobileSessionTokens {
    if (!this.tokens) {
      throw new ApiRequestError('Authentication is required.', 401);
    }
    return this.tokens;
  }

  private async rotate(
    current: MobileSessionTokens,
  ): Promise<MobileSessionTokens> {
    try {
      const response = await this.options.transport<{
        tokens: MobileSessionTokens;
      }>('/auth/refresh', undefined, {
        method: 'POST',
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      await this.establish(response.tokens);
      return response.tokens;
    } catch (error) {
      await this.clear();
      throw error;
    }
  }
}
