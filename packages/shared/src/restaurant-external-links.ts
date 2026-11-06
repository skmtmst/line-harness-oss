/** 外部予約の対応。providerは外部IDの発行元、originProviderは元の媒体。 */
export const RESTAURANT_EXTERNAL_PROVIDERS = [
  'restaurant_board', 'reszaiko', 'hotpepper', 'tabelog', 'gurunavi',
  'ikyu', 'retty', 'google_reservation', 'tablecheck',
] as const;
export type RestaurantExternalProvider = typeof RESTAURANT_EXTERNAL_PROVIDERS[number];

export interface RestaurantExternalLinkWrite {
  provider: RestaurantExternalProvider;
  externalId: string;
  reservationId: string;
  originProvider?: RestaurantExternalProvider | null;
}
export interface RestaurantExternalLinkChange {
  expectedVersion: number;
  reservationId: string;
}
export interface RestaurantExternalLink {
  id: string;
  storeId: string;
  provider: RestaurantExternalProvider;
  externalId: string;
  originProvider: RestaurantExternalProvider | null;
  status: 'linked' | 'unlinked';
  version: number;
  unlinkedAt: string | null;
  updatedAt: string;
  /** 外した後はnull。友だち・卓は予約から読み、別の保存先を作らない。 */
  reservation: {
    id: string;
    customerName: string;
    startsAt: string;
    endsAt: string;
    status: string;
    friend: { id: string; displayName: string } | null;
    tables: Array<{ id: string; label: string }>;
  } | null;
}
export interface RestaurantExternalLinkPage {
  links: RestaurantExternalLink[];
  total: number;
  limit: number;
  offset: number;
}
