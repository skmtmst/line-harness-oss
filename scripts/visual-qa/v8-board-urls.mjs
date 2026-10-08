/**
 * 板ごとの開く場所（開く指定つき）。対応表の行が分類の画面をまとめて並べている・
 * 親の画面（/hq など）だけを書いている板は、ここで正しい場所を決める（監査 ROOT-19）。
 *
 * 読むもの：`build-v8-design-map.mjs`（撮影の対応表）・`build-v8-board-to-code.mjs`（板→コードの表）。
 * 足すときは、その画面の BEHAVIOR.md の「受け付ける URL と指定」と撮影の固定データの ID に合わせる。
 */
export const BOARD_URLS = {
  // 設定・通知の分類の行（そのほか／通知）
  y8QQV: '/notifications',
  g3iDs: '/line-notifications?tab=customer',
  u8xibp: '/line-notifications?tab=operator',
  DrwMm: '/line-notifications?tab=failures',
  PZBVb: '/line-notifications?tab=history',
  gjUz3: '/line-notifications/operator/new',
  V7vn3: '/accounts',
  ihjfd: '/accounts/detail?id=visual-qa-account',
  x2dSNv: '/accounts/handover?id=visual-qa-account',
  Y4LkX1: '/emergency?tab=health',
  I2V65v: '/emergency?tab=history',
  OHwbU: '/emergency?tab=control',
  GmVR5: '/ec-commerce',
  nAesv: '/ec-commerce',
  wqC8x: '/ec-commerce?tab=subscriptions',
  iLJmw: '/ec-commerce?tab=connector',
  w1W8h: '/ec-commerce/identity-candidates',
  u3iab3: '/pools',
  D0AOyx: '/pools/new',
  xuJ7D: '/getting-started',
  // 統括のバナー生成（行は /hq だけ。実際は /hq/banners と /hq/banners/project）
  B9ZAr: '/hq/banners',
  W7Z57: '/hq/banners',
  W5Wxr: '/hq/banners?tab=library',
  AnwtH: '/hq/banners?tab=library',
  iMnph: '/hq/banners/project?id=banner-project-qa-1',
  p03ImY: '/hq/banners/project?id=banner-project-qa-1',
  zOpMG: '/hq/banners/project?id=banner-project-qa-1',
  UcBQ5: '/hq/banners/project?id=banner-project-qa-1',
  rI5uh: '/hq/banners/project?id=banner-project-qa-1',
  B24oNg: '/hq/banners/project?id=banner-project-qa-1',
  I0w2e: '/hq/banners/project?id=banner-project-qa-1',
}
