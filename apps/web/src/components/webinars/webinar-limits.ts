/**
 * ウェビナーの件数上限。サーバー(`apps/worker/src/routes/webinars.ts`)と同じ値。
 *
 * 編集画面(`app/webinars/edit/page.tsx`)から読む。page から直接 export
 * すると Next.js の page 型制約に当たるため、ここに置く。
 */

/* さくらコメント一括置換の件数上限。CTA の 20 件と違い演出行は多い。 */
export const WEBINAR_SAKURA_COMMENTS_MAX = 200
