// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { fetchMe, fetchMileage, postRegister, postAddLink, postEnrollOffer } from './affiliate-profile-api.js';
vi.mock('@line/liff', () => ({ default: { getAccessToken: () => 'private-fixture-token' } }));
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['profile', fetchMe], ['mileage', fetchMileage], ['register', postRegister],
  ['link', () => postAddLink('fixture', null)], ['enroll', () => postEnrollOffer('fixture')],
] as const)('分離後の%sも共通エラーの案内・番号・欄の理由を失わない', async (_name, call) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, error: {
    code: 'VERSION_CONFLICT', message: '最新の内容を確認してください。',
    requestId: 'ab9daa00-9761-40a9-a9ee-a2c21bbe62c0',
    fieldErrors: [{ field: 'label', message: '名前を確認してください。' }],
  } }, { status: 409 })));
  await expect(call()).rejects.toMatchObject({
    status: 409, code: 'VERSION_CONFLICT', message: '最新の内容を確認してください。',
    requestId: 'ab9daa00-9761-40a9-a9ee-a2c21bbe62c0', fields: { label: '名前を確認してください。' },
  });
});

it('内部の本文はプロフィール取得の案内に混ぜない', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: {
    code: 'INTERNAL_SERVER_ERROR', message: 'D1_ERROR token=private-fixture-token',
  } }, { status: 500 })));
  await expect(fetchMe()).rejects.toMatchObject({ status: 500,
    message: '処理できませんでした。状態を確認し、もう一度開き直してください。' });
});
