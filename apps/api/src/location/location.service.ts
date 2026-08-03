import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { PrismaClient } from '@wasel/database';
import type Redis from 'ioredis';

import { DATABASE, REDIS } from '../infrastructure/tokens.js';
import {
  MapsLinkResolutionError,
  type MapsLinkResolutionErrorCode,
  resolveGoogleMapsLink,
} from './maps-link-resolver.js';

type Point = { latitude: number; longitude: number };

const mapsLinkUserMessages: Record<MapsLinkResolutionErrorCode, string> = {
  UNSUPPORTED_LINK:
    'الرابط غير مدعوم. استخدم رابط HTTPS صالحاً من Google Maps.',
  NO_LOCATION:
    'الرابط لا يحتوي موقعاً يمكن فتحه. انسخ رابط مكان أو نتيجة بحث من Google Maps.',
  RESOLUTION_TIMEOUT:
    'انتهت مهلة فتح رابط Google Maps المختصر. حاول مرة أخرى أو حدد الموقع على الخريطة.',
  REDIRECT_BLOCKED:
    'تم حظر تحويل غير آمن في رابط Google Maps. انسخ رابطاً جديداً من التطبيق.',
  NETWORK_FAILURE:
    'تعذر الاتصال بـ Google Maps الآن. تحقق من الشبكة أو حدد الموقع على الخريطة.',
};

@Injectable()
export class LocationService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  public async validate(point: Point) {
    const rows = await this.database.$queryRaw<
      Array<{
        id: string;
        name: string;
        city: string;
        governorate: string;
      }>
    >`
      SELECT "id", "name", "city", "governorate"
      FROM "ServiceZone"
      WHERE "status" = 'ACTIVE'
        AND "allowedDropoff" = true
        AND ST_DWithin(
          ST_SetSRID(
            ST_MakePoint("centerLongitude"::double precision, "centerLatitude"::double precision),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${point.longitude}, ${point.latitude}),
            4326
          )::geography,
          "radiusKm"::double precision * 1000
        )
      ORDER BY "priority" DESC, "name" ASC
      LIMIT 1
    `;
    const zone = rows[0];
    return {
      supported: Boolean(zone),
      serviceZone: zone ?? null,
    };
  }

  public async validatePickup(point: Point) {
    const rows = await this.database.$queryRaw<
      Array<{
        id: string;
        name: string;
        city: string;
        governorate: string;
      }>
    >`
      SELECT "id", "name", "city", "governorate"
      FROM "ServiceZone"
      WHERE "status" = 'ACTIVE'
        AND "allowedPickup" = true
        AND ST_DWithin(
          ST_SetSRID(
            ST_MakePoint("centerLongitude"::double precision, "centerLatitude"::double precision),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${point.longitude}, ${point.latitude}),
            4326
          )::geography,
          "radiusKm"::double precision * 1000
        )
      ORDER BY "priority" DESC, "name" ASC
      LIMIT 1
    `;
    const zone = rows[0];
    return {
      supported: Boolean(zone),
      serviceZone: zone ?? null,
    };
  }

  public async resolveMapsLink(userId: string, value: string) {
    await this.enforceRateLimit(userId);
    try {
      const resolved = await resolveGoogleMapsLink(value);
      if (
        resolved.status === 'MANUAL_SELECTION_REQUIRED' ||
        resolved.latitude === null ||
        resolved.longitude === null
      ) {
        return {
          ...resolved,
          validation: null,
        };
      }
      return {
        ...resolved,
        validation: await this.validate({
          latitude: resolved.latitude,
          longitude: resolved.longitude,
        }),
      };
    } catch (error) {
      if (error instanceof MapsLinkResolutionError) {
        throw new BadRequestException(mapsLinkUserMessages[error.code]);
      }
      throw error;
    }
  }

  public async resolvePublicMerchantMapsLink(
    ipAddress: string | undefined,
    value: string,
  ) {
    await this.enforcePublicMerchantLocationLimit(ipAddress);
    try {
      const resolved = await resolveGoogleMapsLink(value);
      if (
        resolved.status === 'MANUAL_SELECTION_REQUIRED' ||
        resolved.latitude === null ||
        resolved.longitude === null
      ) {
        return {
          ...resolved,
          validation: null,
        };
      }
      return {
        ...resolved,
        validation: await this.validatePickup({
          latitude: resolved.latitude,
          longitude: resolved.longitude,
        }),
      };
    } catch (error) {
      if (error instanceof MapsLinkResolutionError) {
        throw new BadRequestException(mapsLinkUserMessages[error.code]);
      }
      throw error;
    }
  }

  public async enforcePublicMerchantLocationLimit(
    ipAddress: string | undefined,
  ) {
    const window = Math.floor(Date.now() / 60_000);
    const key = `merchant-registration:location:${ipAddress ?? 'unknown'}:${window}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 70);
    if (count > 20) {
      throw new HttpException(
        'محاولات تحديد الموقع كثيرة. انتظر دقيقة ثم حاول مرة أخرى.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async enforceRateLimit(userId: string) {
    const window = Math.floor(Date.now() / 60_000);
    const key = `location:maps-link:${userId}:${window}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 70);
    if (count > 10) {
      throw new HttpException(
        'Too many Google Maps link resolution attempts.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
