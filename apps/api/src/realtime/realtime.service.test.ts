import { describe, expect, it } from 'vitest';

import { RealtimeService } from './realtime.service.js';

describe('Realtime room authorization', () => {
  const service = new RealtimeService(
    {} as never,
    {
      ACCESS_TOKEN_SECRET: 'x'.repeat(32),
      CORS_ORIGINS: '',
      NODE_ENV: 'test',
    },
    {} as never,
  );

  it('never lets a courier join merchant, admin, or tracking rooms', () => {
    const rooms = service.roomsForPrincipal({
      userId: 'user-1',
      role: 'courier',
      merchantIds: [],
      courierId: 'courier-1',
      serviceZoneIds: ['zone-1'],
    });
    expect(rooms).toEqual([
      'user:user-1',
      'courier:courier-1',
      'service-zone:zone-1',
    ]);
    expect(rooms.some((room) => room.includes('tracking'))).toBe(false);
  });

  it('isolates merchant rooms to memberships', () => {
    expect(
      service.roomsForPrincipal({
        userId: 'owner',
        role: 'merchant_owner',
        merchantIds: ['merchant-1'],
        serviceZoneIds: [],
      }),
    ).toEqual(['user:owner', 'merchant:merchant-1']);
  });
});
