import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  public health() {
    return {
      service: 'wasel-api',
      status: 'ok',
      phase: 1,
      phaseTwoFeaturesEnabled: false,
      timestamp: new Date().toISOString(),
    } as const;
  }
}
