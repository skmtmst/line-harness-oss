/** 予約写真は既存の登録メディアを参照する。各メニュー・スタッフ1枚、お店3枚。 */
export const BOOKING_STORE_PHOTO_SLOTS = ['exterior', 'interior', 'waiting'] as const;
export type BookingStorePhotoSlot = typeof BOOKING_STORE_PHOTO_SLOTS[number];
export type BookingStorePhotoVisibility = Record<BookingStorePhotoSlot, boolean>;
export type BookingPhotoOwner = 'menu' | 'staff' | 'store';
export interface BookingPhoto {
  mediaId: string;
  url: string;
}
export interface BookingPhotoItem {
  id: string;
  name: string;
  version: number;
  photo: BookingPhoto | null;
}
export interface BookingPhotoCatalog {
  menus: BookingPhotoItem[];
  staff: BookingPhotoItem[];
  store: {
    id: string;
    version: number;
    photos: Record<BookingStorePhotoSlot, BookingPhoto | null>;
    order: BookingStorePhotoSlot[];
    visibility?: BookingStorePhotoVisibility;
  } | null;
}
export type BookingPhotoWrite = { expectedVersion: number; mediaId: string | null };
export type BookingStorePhotosWrite = {
  expectedVersion: number;
  photos: Record<BookingStorePhotoSlot, string | null>;
  order: BookingStorePhotoSlot[];
  /** Omitted by older clients: preserve the saved selection. Unset slots stay private. */
  visibility?: BookingStorePhotoVisibility;
};
