export const orderStatuses = [
  'draft',
  'quoted',
  'searching_courier',
  'courier_assigned',
  'courier_arriving_pickup',
  'at_pickup',
  'picked_up',
  'in_transit',
  'at_dropoff',
  'delivered',
  'delivery_failed',
  'returning_to_store',
  'returned',
  'cancelled',
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export const featureFlagKeys = [
  'cash_on_delivery',
  'surge_pricing',
  'scheduled_deliveries',
  'multi_stop_delivery',
  'subscriptions',
] as const;

export type FeatureFlagKey = (typeof featureFlagKeys)[number];
