
export const DELIVERY_SERVICES = ['ubereats', 'demaecan', 'rocketnow'] as const;

export type DeliveryService = (typeof DELIVERY_SERVICES)[number];
