import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  public health() {
    return {
      service: 'skka-api',
      status: 'ok',
      phase: 4,
      phaseTwoFeaturesEnabled: true,
      phaseFourFeaturesEnabled: true,
      dispatchFeaturesEnabled: false,
      cashOnDeliveryEnabled: false,
      timestamp: new Date().toISOString(),
    } as const;
  }
}
