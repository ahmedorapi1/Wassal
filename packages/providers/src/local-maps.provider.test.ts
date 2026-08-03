import { describe, expect, it } from 'vitest';

import { DeterministicLocalMapsProvider } from './local-maps.provider.js';

describe('DeterministicLocalMapsProvider', () => {
  const provider = new DeterministicLocalMapsProvider();

  it('returns the same backend-authoritative route every time', async () => {
    const input = [
      { latitude: 31.41754, longitude: 31.81444 },
      { latitude: 31.4321, longitude: 31.8273 },
    ] as const;
    await expect(provider.route(...input)).resolves.toEqual(
      await provider.route(...input),
    );
  });

  it('rejects invalid coordinates', async () => {
    await expect(
      provider.route(
        { latitude: 91, longitude: 31 },
        { latitude: 31, longitude: 31 },
      ),
    ).rejects.toThrow('invalid');
  });
});
