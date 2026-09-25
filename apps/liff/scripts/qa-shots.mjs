/**
 * LIFF 撮影モードの台本。手元のブラウザで各画面を撮影・点検する。
 *
 * 前提 (別々の端末で起動しておく):
 *   1. 偽 API: `node apps/liff/scripts/qa-mock.mjs` (:8790)
 *   2. 撮影ビルド: `VITE_LIFF_QA=1 VITE_API_BASE=http://localhost:8790 npx vite build`
 *      のあと `npx vite preview --port 3002`
 *      (開発時は `VITE_LIFF_QA=1 VITE_API_BASE=http://localhost:8790 npx vite --port 3002`
 *       でもよい)
 *
 * 動かし方: `node apps/liff/scripts/qa-shots.mjs [保存先]`
 *   QA_BASE_URL (既定 http://localhost:3002) / QA_MOCK_URL (既定 http://localhost:8790)
 *
 * 375×812 と 414×896 で、通常・読み込み中・失敗(API 500) を撮る。
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '/Users/kentakenta/lh-work/m7h/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs';

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:3002';
const MOCK = process.env.QA_MOCK_URL ?? 'http://localhost:8790';
const OUT = process.argv[2] ?? 'apps/liff/scripts/qa-shots-out';

const VIEWPORTS = [
  { name: '375x812', width: 375, height: 812 },
  { name: '414x896', width: 414, height: 896 },
];

async function setMock(next) {
  const res = await fetch(`${MOCK}/__qa/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  if (!res.ok) throw new Error(`mock state failed: ${res.status}`);
}

async function resetMock() {
  await fetch(`${MOCK}/__qa/reset`, { method: 'POST' });
}

const failures = [];

/** @param {{ mock?: object, waitMs?: number, after?: (page) => Promise<void> }} opts */
async function shot(page, viewport, name, url, opts = {}) {
  await resetMock();
  if (opts.mock) await setMock(opts.mock);
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(opts.waitMs ?? 1500);
    if (opts.after) await opts.after(page);
    await page.screenshot({ path: join(OUT, viewport.name, `${name}.png`), fullPage: true });
    console.log(`ok ${viewport.name}/${name}`);
  } catch (err) {
    failures.push(`${viewport.name}/${name}: ${err.message}`);
    console.error(`ng ${viewport.name}/${name}: ${err.message}`);
  } finally {
    await resetMock();
  }
}

const browser = await chromium.launch();
try {
  for (const viewport of VIEWPORTS) {
    mkdirSync(join(OUT, viewport.name), { recursive: true });
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
    });

    // 予約 (メニュー→担当→日時→確認→完了まで進める)
    await shot(page, viewport, 'booking', '/booking?liffId=qa', { waitMs: 2000 });
    await shot(page, viewport, 'booking-loading', '/booking?liffId=qa', {
      mock: { delayMs: 5000 },
      waitMs: 1200,
    });
    await shot(page, viewport, 'booking-error', '/booking?liffId=qa', {
      mock: { fail: 'all' },
      waitMs: 2000,
    });
    await shot(page, viewport, 'booking-confirm', '/booking?liffId=qa', {
      waitMs: 1500,
      after: async (p) => {
        await p.getByRole('button', { name: 'QA カット' }).click();
        await p.getByRole('button', { name: '担当を選ぶ' }).click();
        await p.getByRole('button', { name: /QA スタッフ/ }).click();
        await p.getByRole('button', { name: '日時を選ぶ' }).click();
        await p.getByRole('button', { name: '10:00' }).click();
        await p.getByRole('button', { name: /で確認へ/ }).click();
      },
    });
    await shot(page, viewport, 'booking-done', '/booking?liffId=qa', {
      waitMs: 1500,
      after: async (p) => {
        await p.getByRole('button', { name: 'QA カット' }).click();
        await p.getByRole('button', { name: '担当を選ぶ' }).click();
        await p.getByRole('button', { name: /QA スタッフ/ }).click();
        await p.getByRole('button', { name: '日時を選ぶ' }).click();
        await p.getByRole('button', { name: '10:00' }).click();
        await p.getByRole('button', { name: /で確認へ/ }).click();
        await p.getByRole('button', { name: '予約をリクエストする' }).click();
        await p.waitForTimeout(1500);
      },
    });

    // 予約履歴
    await shot(page, viewport, 'booking-history', '/booking/history?liffId=qa', { waitMs: 2000 });
    await shot(page, viewport, 'booking-history-loading', '/booking/history?liffId=qa', {
      mock: { delayMs: 5000 },
      waitMs: 1200,
    });
    await shot(page, viewport, 'booking-history-error', '/booking/history?liffId=qa', {
      mock: { fail: 'all' },
      waitMs: 2000,
    });

    // イベント一覧 (自分のイベント予約)
    await shot(page, viewport, 'events-me', '/events/me?liffId=qa', { waitMs: 2000 });
    await shot(page, viewport, 'events-me-loading', '/events/me?liffId=qa', {
      mock: { delayMs: 5000 },
      waitMs: 1200,
    });
    await shot(page, viewport, 'events-me-error', '/events/me?liffId=qa', {
      mock: { fail: 'all' },
      waitMs: 2000,
    });

    // イベント詳細
    await shot(page, viewport, 'event-detail', '/events/qa-event-1?liffId=qa', { waitMs: 2000 });
    await shot(page, viewport, 'event-detail-loading', '/events/qa-event-1?liffId=qa', {
      mock: { delayMs: 5000 },
      waitMs: 1200,
    });
    await shot(page, viewport, 'event-detail-error', '/events/qa-event-1?liffId=qa', {
      mock: { fail: 'all' },
      waitMs: 2000,
    });

    // イベント確認
    await shot(page, viewport, 'event-confirm', '/events/qa-event-1/confirm?slotId=qa-slot-1&liffId=qa', {
      waitMs: 2000,
    });
    await shot(page, viewport, 'event-confirm-loading', '/events/qa-event-1/confirm?slotId=qa-slot-1&liffId=qa', {
      mock: { delayMs: 5000 },
      waitMs: 1200,
    });
    await shot(page, viewport, 'event-confirm-error', '/events/qa-event-1/confirm?slotId=qa-slot-1&liffId=qa', {
      mock: { fail: 'all' },
      waitMs: 2000,
    });

    // イベント完了 (確定・承認待ちの2種)
    await shot(page, viewport, 'event-done', '/events/qa-event-1/done?bookingId=qa-1&status=confirmed&liffId=qa');
    await shot(page, viewport, 'event-done-pending', '/events/qa-event-1/done?bookingId=qa-1&status=requested&liffId=qa');

    // 待ちの案内 (準備→確定→失敗)
    await shot(page, viewport, 'waitlist', '/?eventWaitlistToken=qa-token-1&liffId=qa');
    await shot(page, viewport, 'waitlist-confirmed', '/?eventWaitlistToken=qa-token-1&liffId=qa', {
      after: async (p) => {
        await p.getByRole('button', { name: 'この席を予約する' }).click();
        await p.waitForTimeout(1200);
      },
    });
    await shot(page, viewport, 'waitlist-error', '/?eventWaitlistToken=qa-token-1&liffId=qa', {
      mock: { fail: 'all' },
      after: async (p) => {
        await p.getByRole('button', { name: 'この席を予約する' }).click();
        await p.waitForTimeout(1200);
      },
    });

    // アフィリエイト
    await shot(page, viewport, 'affiliate', '/affiliate?liffId=qa', { waitMs: 2500 });
    await shot(page, viewport, 'affiliate-loading', '/affiliate?liffId=qa', {
      mock: { delayMs: 5000 },
      waitMs: 1200,
    });
    await shot(page, viewport, 'affiliate-error', '/affiliate?liffId=qa', {
      mock: { fail: 'all' },
      waitMs: 2500,
    });

    // ウェビナー (配信中・開始前)
    await shot(page, viewport, 'webinar-live', '/webinar/qa-webinar?liffId=qa', { waitMs: 2500 });
    await shot(page, viewport, 'webinar-live-loading', '/webinar/qa-webinar?liffId=qa', {
      mock: { delayMs: 5000 },
      waitMs: 1200,
    });
    await shot(page, viewport, 'webinar-live-error', '/webinar/qa-webinar?liffId=qa', {
      mock: { fail: 'all' },
      waitMs: 2500,
    });
    await shot(page, viewport, 'webinar-waiting', '/webinar/qa-webinar-waiting?liffId=qa', { waitMs: 2000 });

    // フォーム
    await shot(page, viewport, 'form', '/forms/qa-form-1?liffId=qa', { waitMs: 2000 });
    await shot(page, viewport, 'form-loading', '/forms/qa-form-1?liffId=qa', {
      mock: { delayMs: 5000 },
      waitMs: 1200,
    });
    await shot(page, viewport, 'form-error', '/forms/qa-form-1?liffId=qa', {
      mock: { fail: 'all' },
      waitMs: 2000,
    });

    await page.close();
  }
} finally {
  await browser.close();
  await resetMock().catch(() => undefined);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} shots failed:`);
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`\ndone. out=${OUT}`);
