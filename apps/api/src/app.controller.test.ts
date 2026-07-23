import { describe, expect, it } from 'vitest';

import { AppController } from './app.controller.js';

describe('AppController', () => {
  it('reports the Phase 1 API health with later features disabled', () => {
    expect(new AppController().health()).toMatchObject({
      service: 'wasel-api',
      status: 'ok',
      phase: 1,
      phaseTwoFeaturesEnabled: false,
    });
  });
});
