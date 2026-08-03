import type { Coordinates } from '@wasel/validation';

export type OtpPurpose = 'sign_in' | 'verify_phone' | 'confirm_delivery';

export interface OtpProvider {
  request(
    phone: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<{ providerReference: string }>;
}

export interface MapsProvider {
  geocode(address: string): Promise<Coordinates>;
  validateCoordinates(coordinates: Coordinates): boolean;
  route(
    origin: Coordinates,
    destination: Coordinates,
  ): Promise<{
    distanceMeters: number;
    durationSeconds: number;
    geometry?: string;
  }>;
}

export interface NotificationProvider {
  send(input: {
    recipientId: string;
    template: string;
    channel: 'push' | 'sms';
    variables: Readonly<Record<string, string>>;
  }): Promise<{ providerReference: string }>;
}

export interface PaymentProvider {
  authorize(input: {
    idempotencyKey: string;
    amountMinor: number;
    currency: string;
  }): Promise<{ providerReference: string; status: 'authorized' | 'declined' }>;
}

export interface ObjectStorageProvider {
  createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string>;
  putObject(input: {
    objectKey: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
  getObject(objectKey: string): Promise<{
    contentType: string;
    bytes: Uint8Array;
  }>;
}

export interface PhoneMaskingProvider {
  createSession(
    callerPhone: string,
    recipientPhone: string,
  ): Promise<{ maskedPhone: string }>;
}
