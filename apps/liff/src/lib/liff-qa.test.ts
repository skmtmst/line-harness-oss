import { describe, expect, test } from 'vitest';
import qaLiff from './liff-qa.js';

/**
 * 撮影モードの偽 LIFF。ログイン済み・作り物の名前を返す。
 * 実在の個人情報は入れない。
 */
describe('qa liff fake', () => {
  test('init するまで未ログイン、init 後はログイン済み', async () => {
    expect(qaLiff.isLoggedIn()).toBe(false);
    await qaLiff.init({ liffId: 'qa-liff-id' });
    expect(qaLiff.isLoggedIn()).toBe(true);
  });

  test('作り物のプロフィールを返す', async () => {
    const profile = await qaLiff.getProfile();
    expect(profile.displayName.length).toBeGreaterThan(0);
    expect(profile.userId.startsWith('U')).toBe(true);
  });

  test('API 呼び出しに使う token を返す', () => {
    expect(qaLiff.getIDToken()).toBeTruthy();
    expect(qaLiff.getAccessToken()).toBeTruthy();
  });

  test('クライアント内判定は偽装しない', () => {
    expect(qaLiff.isInClient()).toBe(false);
  });
});
