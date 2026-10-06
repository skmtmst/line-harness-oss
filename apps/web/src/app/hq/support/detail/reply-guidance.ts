/**
 * お問い合わせ詳細（36-3-A）の返信先案内文。
 *
 * 送り先の根拠は `apps/worker/src/routes/hq-support.ts` の続き送信
 *（`POST /api/hq/support/requests/:id/messages`）が正本。
 * 運営への知らせは毎回送り、送信者への控えは `staffEmail` があるときだけ送る。
 * 運営の返信はやり取り（この画面）に必ず並び、メールがあれば登録メールにも届く。
 * メールが無いのにメール到着を案内しないよう、文言はメールの有無で分ける。
 * page.tsx と試験の両方から import する（page.tsx は default 以外を export できない）。
 */

export function supportReplyNote(hasSenderEmail: boolean): string {
  return hasSenderEmail
    ? '運営からの返信はここと登録メールアドレスに届きます。追加で伝えたいことは、下の欄から同じ件の続きとして送れます。'
    : '運営からの返信はここに届きます。追加で伝えたいことは、下の欄から同じ件の続きとして送れます。'
}

export function supportSenderNote(hasSenderEmail: boolean): string {
  return hasSenderEmail
    ? 'この内容が続きに添えられます。返信はこのメールアドレスに届きます。'
    : 'この内容が続きに添えられます。返信はこの画面のやり取りに届きます。'
}

export function supportSendStatus(hasSenderEmail: boolean): string {
  return hasSenderEmail
    ? '送ると運営の対応は「対応中」に戻ります。控えが登録メールアドレスにも届きます'
    : '送ると運営の対応は「対応中」に戻ります。返信はこの画面で確認できます'
}

export function supportSentNotice(hasSenderEmail: boolean): string {
  return hasSenderEmail
    ? '続きを送りました。運営に届き、控えが登録メールアドレスにも届きます。'
    : '続きを送りました。運営に届きました。返信はこの画面のやり取りに届きます。'
}
