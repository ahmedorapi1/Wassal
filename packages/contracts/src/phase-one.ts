import type { Role } from './rbac.js';

export const courierVerificationStatuses = [
  'incomplete',
  'pending_review',
  'changes_requested',
  'approved',
  'rejected',
  'suspended',
] as const;

export type CourierVerificationStatus =
  (typeof courierVerificationStatuses)[number];

export const courierDocumentTypes = [
  'national_id_front',
  'national_id_back',
  'driver_license',
  'vehicle_license',
  'profile_photo',
] as const;

export type CourierDocumentType = (typeof courierDocumentTypes)[number];

export const courierDocumentStatuses = [
  'pending',
  'approved',
  'rejected',
  'changes_requested',
  'expired',
  'superseded',
] as const;

export type CourierDocumentStatus = (typeof courierDocumentStatuses)[number];

export type AuthenticatedUser = {
  id: string;
  phone: string;
  displayName: string | null;
  role: Role;
  status: 'pending' | 'active' | 'suspended' | 'blocked';
  locale: 'ar-EG' | 'en';
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
};

export type SessionPrincipal = {
  userId: string;
  sessionId: string;
  role: Role;
};

export const phaseOneFeatureFlags = {
  cash_on_delivery: false,
  surge_pricing: false,
  scheduled_deliveries: false,
  multi_stop_delivery: false,
  subscriptions: false,
} as const;
