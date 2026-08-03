const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

function parsedUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export function resolveCourierApiUrl(
  configuredUrl: string | undefined,
  metroBundleUrl: string | undefined,
  platform: string,
): string {
  const configured = parsedUrl(configuredUrl);
  if (configured && !localHosts.has(configured.hostname)) {
    return configured.toString().replace(/\/$/, '');
  }

  const metro = parsedUrl(metroBundleUrl);
  if (metro && !localHosts.has(metro.hostname)) {
    return `http://${metro.hostname}:3100/api/v1`;
  }

  if (platform === 'android') {
    throw new Error(
      'EXPO_PUBLIC_API_URL must use this computer LAN address, not localhost.',
    );
  }

  if (configured) return configured.toString().replace(/\/$/, '');
  return 'http://localhost:3100/api/v1';
}
