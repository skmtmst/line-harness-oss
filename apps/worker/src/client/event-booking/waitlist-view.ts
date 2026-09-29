/*
 * イベント申込画面の「キャンセル待ち」まわりの判断 (#747 / N-416)。
 *
 * main.tsx から切り出してある。理由は2つ。
 *  - worker の vitest は `src/**\/*.test.ts` だけを拾う (`.tsx` は拾わない)。
 *    描画の土台も無いので、判断を素の関数にしないと試験で見張れない
 *  - 同じ判断を「押せるか」「何と書くか」「完了画面の出し分け」の3か所で
 *    使う。1か所にまとめておかないと、どれかだけ直して食い違う
 *
 * **main.tsx は必ずこの関数を通すこと。**画面側に同じ条件を書き直すと、
 * ここを壊しても試験が緑のままになる。
 */

/** 申込のあと、完了画面が出す結末。 */
export type BookingOutcome = 'waitlisted' | 'requested' | 'confirmed';

/**
 * 枠のボタンを押せなくするか。
 *
 * 満席でも、その回がキャンセル待ちを受けるなら押せる。サーバは前から
 * 満席の申込を待ち行列へ入れて 200 を返していたのに、画面が押させないので
 * その口へ辿り着けなかった。
 *
 * 予約上限に達している人は、待ちにも入れないので押せないままにする。
 */
export function isSlotDisabled(input: {
  full: boolean;
  waitlistOpen: boolean;
  overLimit: boolean;
}): boolean {
  if (input.overLimit) return true;
  if (!input.full) return false;
  return !input.waitlistOpen;
}

/** 枠の右肩に出す残席の表示。 */
export function slotSeatLabel(input: {
  capacity: number | null;
  remaining: number | null;
  waitlistOpen: boolean;
}): string {
  const full = input.remaining != null && input.remaining <= 0;
  if (full) return input.waitlistOpen ? '満員（キャンセル待ち）' : '満員';
  if (input.capacity == null) return '定員なし';
  return `残 ${input.remaining}`;
}

/**
 * 申込の応答から結末を決める。
 *
 * キャンセル待ちに入ったときの応答は **200** で `{ waitlisted: true }`。
 * 200 なので送信側は例外を投げない。ここで見分けないと `status` が
 * undefined のまま完了画面へ渡り、**待ちに入っただけの人に
 * 「予約が確定しました」と出す。**
 */
export function bookingOutcome(response: {
  status?: string | null;
  waitlisted?: boolean;
}): BookingOutcome {
  if (response.waitlisted === true) return 'waitlisted';
  if (response.status === 'requested') return 'requested';
  return 'confirmed';
}

export interface DoneScreenCopy {
  icon: string;
  title: string;
  body: string;
}

/** 完了画面の文言。待ち・承認待ち・確定の3通り。 */
export function doneScreenCopy(outcome: BookingOutcome): DoneScreenCopy {
  if (outcome === 'waitlisted') {
    return {
      icon: '🕒',
      title: 'キャンセル待ちに入りました',
      body:
        '満席のため、キャンセル待ちにお入れしました。空きが出たら LINE でご案内します。'
        + 'この時点では予約は取れていません。',
    };
  }
  if (outcome === 'requested') {
    return {
      icon: '⏳',
      title: '受付しました',
      body: '運営の承認をお待ちください。承認されると LINE でお知らせします。',
    };
  }
  return {
    icon: '✅',
    title: '予約が確定しました',
    body: '予約が確定しました。LINE で詳細をお送りしました。',
  };
}
