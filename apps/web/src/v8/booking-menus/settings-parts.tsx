'use client'

import { jstDate, jstDateOffset } from '@/lib/jst-datetime';
import { memo } from 'react';
import dynamic from 'next/dynamic';
import { SkeletonRows } from './tabs/shared';

export const LiffPhoneMenuStep = memo(dynamic(() => import('./liff-phone').then((module) => module.LiffPhoneMenuStep), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
export const LiffPhoneDatetimeStep = memo(dynamic(() => import('./liff-phone').then((module) => module.LiffPhoneDatetimeStep), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
export const LiffPhoneStaffStep = memo(dynamic(() => import('./liff-phone').then((module) => module.LiffPhoneStaffStep), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
export const MenusTabV8 = memo(dynamic(() => import('./tabs/menus-tab').then((module) => module.MenusTabV8), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
export const HoursTabV8 = memo(dynamic(() => import('./tabs/hours-tab').then((module) => module.HoursTabV8), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
export const HolidaysTabV8 = memo(dynamic(() => import('./tabs/holidays-tab').then((module) => module.HolidaysTabV8), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
export const RulesTabV8 = memo(dynamic(() => import('./tabs/rules-tab').then((module) => module.RulesTabV8), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
export const PaymentsTabV8 = memo(dynamic(() => import('../booking-payments/payments-tab/index').then((module) => module.PaymentsTabV8), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
export const PaymentsSideV8 = memo(dynamic(() => import('../booking-payments/payments-side/index'), {
  loading: () => <SkeletonRows rows={5} />,
  ssr: false,
}))
export const StaffTabV8 = memo(dynamic(() => import('./tabs/staff-tab').then((module) => module.StaffTabV8), {
  loading: () => <SkeletonRows rows={7} />,
  ssr: false,
}))
export const PhotosTabV8 = memo(dynamic(() => import('./photos'), { loading: () => <SkeletonRows rows={3} />, ssr: false }))
export const V8_TABS = [
  { key: 'menus', label: 'メニュー', node: 'owaS3' },
  { key: 'hours', label: '受付枠', node: 'yRPxl' },
  { key: 'holidays', label: '休業日', node: 'KRgTQ' },
  { key: 'rules', label: '予約のルール', node: 'x1OZS6' },
  { key: 'staff', label: '担当スタッフ', node: 'VLEaj' },
  { key: 'payments', label: 'お支払い', node: 'FcGmv' },
  { key: 'passes', label: '回数券・月謝', node: 'uGfHo' },
  { key: 'channels', label: '予約経路の連携', node: 'ZyDd6' },
  { key: 'photos', label: '写真', node: 'NQtrW' },
] as const
export type V8TabKey = (typeof V8_TABS)[number]['key']
export const V8_TAB_KEYS = new Set<string>(V8_TABS.map((tab) => tab.key))
export const V8_TAB_NODE: Record<V8TabKey, string> = {
  menus: 'owaS3',
  hours: 'yRPxl',
  holidays: 'KRgTQ',
  rules: 'x1OZS6',
  staff: 'VLEaj',
  channels: 'ZyDd6',
  passes: 'uGfHo',
  payments: 'FcGmv',
  photos: 'NQtrW',
}
export function previewRange(): { from: string; to: string } {
  const now = new Date()
  return { from: jstDate(now), to: jstDateOffset(13, now) }
}
