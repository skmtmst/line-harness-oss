/**
 * 撮影モード専用の偽 LIFF。
 *
 * `VITE_LIFF_QA=1` でビルドしたときだけ vite.config.ts の alias で
 * `@line/liff` の代わりに読み替える。本番ビルドには束ねない
 * (src から静的に import しないこと。qa-guard.test.ts が見張る)。
 *
 * window / document を触らないので node の vitest でも動く。
 */

export interface QaProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

/** 作り物の利用者。実在の個人情報は入れない。 */
const QA_PROFILE: QaProfile = {
  userId: 'U0000000000000000000000000000qa',
  displayName: 'QA たろう',
};

const QA_ID_TOKEN = 'qa-id-token-not-a-secret';
const QA_ACCESS_TOKEN = 'qa-access-token-not-a-secret';

let initialized = false;

const qaLiff = {
  async init(_options: { liffId: string }): Promise<void> {
    initialized = true;
  },
  isLoggedIn(): boolean {
    return initialized;
  },
  login(): void {
    // 撮影モードではログイン画面を出さず、そのまま進む。
  },
  async getProfile(): Promise<QaProfile> {
    return { ...QA_PROFILE };
  },
  getIDToken(): string | null {
    return QA_ID_TOKEN;
  },
  getAccessToken(): string {
    return QA_ACCESS_TOKEN;
  },
  isInClient(): boolean {
    return false;
  },
  openWindow(_options: { url: string; external?: boolean }): void {
    // 撮影モードでは外部ブラウザを開かない。
  },
};

export default qaLiff;
