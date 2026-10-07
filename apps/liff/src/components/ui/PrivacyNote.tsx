/**
 * 送る前の、個人情報の取り扱いの一行（2026-10-07 オーナー決定）。
 *
 * 基本は musubo のプライバシーポリシーへつなぐ。お店ごとのポリシーの URL が
 * 設定されていればそちらを優先する（いまは設定の口が無いので、呼ぶ側は渡さない）。
 * 予約・申し込み・フォームの送る画面の、中身の最後に置く。リンクは押しやすい高さ（44）を取る。
 */
export const MUSUBO_PRIVACY_URL = 'https://musubo.jp/privacy/';

export function privacyPolicyUrl(shopPrivacyUrl?: string | null): string {
  const url = shopPrivacyUrl?.trim();
  return url && /^https:\/\//.test(url) ? url : MUSUBO_PRIVACY_URL;
}

export default function PrivacyNote({ shopPrivacyUrl }: { shopPrivacyUrl?: string | null }) {
  return (
    <p className="text-center text-[11px] leading-[18px] text-liff-sub" data-privacy-note="">
      送った内容は
      <a
        href={privacyPolicyUrl(shopPrivacyUrl)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center px-1 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ink"
      >
        プライバシーポリシー
      </a>
      に沿って取り扱います。
    </p>
  );
}
