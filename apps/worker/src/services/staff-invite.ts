import type { Env } from '../index.js';
import { renderMailHtml } from './mail-html.js';
import { sendPlainMail as send } from './plain-mail.js';

type Invite = { name: string; email: string; verifyUrl?: string; lineUrl?: string };

/*
 * 件名の【musubo】で差出人の表示名が musubo になる（mail-from-name）。
 * 飾り付きの本文は renderMailHtml で作り、文字の本文と同じ材料を渡す。
 * 文字の本文は消さない。HTMLを読めない相手にも同じことが伝わるようにする。
 */
export async function sendStaffInviteEmail(env: Env['Bindings'], input: Invite): Promise<void> {
  await send(env, {
    to: input.email,
    subject: '【musubo】管理画面への招待',
    body: `${input.name} 様\n\n管理画面へ招待されました。次のURLからメールアドレスを確認してください。\n${input.verifyUrl}\n\nこのURLの有効期限は7日間です。`,
    html: renderMailHtml({
      heading: '管理画面への招待',
      lead: `${input.name} 様`,
      paragraphs: ['管理画面へ招待されました。下のボタンからメールアドレスを確認してください。'],
      action: { label: 'メールアドレスを確認する', url: input.verifyUrl ?? '' },
      notes: ['このリンクの有効期限は7日間です。'],
    }),
  });
}

export async function sendStaffLineLinkEmail(env: Env['Bindings'], input: Invite): Promise<void> {
  await send(env, {
    to: input.email,
    subject: '【musubo】LINE連携を完了してください',
    body: `${input.name} 様\n\nメールアドレスの確認が完了しました。次のURLからLINE認証を行うと、管理画面へログインできます。\n${input.lineUrl}\n\n以後のログインはLINEを使用します。`,
    html: renderMailHtml({
      heading: 'LINE連携を完了してください',
      lead: `${input.name} 様`,
      paragraphs: ['メールアドレスの確認が完了しました。下のボタンからLINE認証を行うと、管理画面へログインできます。'],
      action: { label: 'LINE連携を行う', url: input.lineUrl ?? '' },
      notes: ['以後のログインはLINEを使用します。'],
    }),
  });
}

/*
 * N-433: 本人が自分のメールアドレスを変えるときの確認便り。
 *
 * 新しい宛先へ確認リンクを送り、開かれてはじめて変更が確定する。
 * 旧アドレスへは申し込みと完了の知らせを送り、覚えのない変更に
 * 気づけるようにする（乗っ取りの早期発見）。
 */
export async function sendStaffEmailChangeConfirmEmail(
  env: Env['Bindings'],
  input: { name: string; email: string; confirmUrl: string },
): Promise<void> {
  await send(env, {
    to: input.email,
    subject: '【musubo】メールアドレス変更の確認',
    body: `${input.name} 様\n\n管理画面のメールアドレスの変更が申し込まれました。このアドレスへ変更するには、次のURLを開いて確認してください。\n${input.confirmUrl}\n\nこのURLの有効期限は24時間です。覚えのない申し込みのときは、このメールを破棄してください。`,
    html: renderMailHtml({
      heading: 'メールアドレス変更の確認',
      lead: `${input.name} 様`,
      paragraphs: ['管理画面のメールアドレスの変更が申し込まれました。このアドレスへ変更するには、下のボタンから確認してください。'],
      action: { label: '変更を確認する', url: input.confirmUrl },
      notes: [
        'このリンクの有効期限は24時間です。',
        '覚えのない申し込みのときは、このメールを破棄してください。',
      ],
    }),
  });
}

/** 申し込みがあったことを旧アドレスへ知らせる。 */
export async function sendStaffEmailChangeNoticeEmail(
  env: Env['Bindings'],
  input: { name: string; email: string; next: string },
): Promise<void> {
  await send(env, {
    to: input.email,
    subject: '【musubo】メールアドレス変更のお知らせ',
    body: `${input.name} 様\n\n管理画面のメールアドレスを ${input.next} へ変更する申し込みがありました。\n\n覚えのない申し込みのときは、管理者へ連絡してください。`,
    html: renderMailHtml({
      heading: 'メールアドレス変更のお知らせ',
      lead: `${input.name} 様`,
      paragraphs: [`管理画面のメールアドレスを ${input.next} へ変更する申し込みがありました。`],
      notes: ['覚えのない申し込みのときは、管理者へ連絡してください。'],
    }),
  });
}

/** 変更が確定したことを旧アドレスへ知らせる。 */
export async function sendStaffEmailChangeCompletedEmail(
  env: Env['Bindings'],
  input: { name: string; email: string; next: string },
): Promise<void> {
  await send(env, {
    to: input.email,
    subject: '【musubo】メールアドレスを変更しました',
    body: `${input.name} 様\n\n管理画面のメールアドレスを ${input.next} へ変更しました。\n\n覚えのない変更のときは、管理者へ連絡してください。`,
    html: renderMailHtml({
      heading: 'メールアドレスを変更しました',
      lead: `${input.name} 様`,
      paragraphs: [`管理画面のメールアドレスを ${input.next} へ変更しました。`],
      notes: ['覚えのない変更のときは、管理者へ連絡してください。'],
    }),
  });
}
