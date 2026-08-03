import { describe, expect, it } from 'vitest';

import { AppController } from './app.controller.js';

describe('AppController', () => {
  it('reports the Phase 4 API health with dispatch and COD disabled', () => {
    expect(new AppController().health()).toMatchObject({
      service: 'skka-api',
      status: 'ok',
      phase: 4,
      phaseTwoFeaturesEnabled: true,
      phaseFourFeaturesEnabled: true,
      dispatchFeaturesEnabled: false,
      cashOnDeliveryEnabled: false,
    });
  });
});
