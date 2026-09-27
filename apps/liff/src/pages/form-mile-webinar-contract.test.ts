import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * LIFF ★V7 その3 (回答フォーム・マイル・ウェビナー) の契約。
 *
 * 流儀は ui-contract.test.ts と同じ (描画試験はしない。文面を読む)。
 * 動き (送信・二重押し防止・時刻の同期・計測) の本体は変えず、
 * 見た目だけ ★V7 (4-form・6-mile・7-webinar) に寄せたことを見る。
 */

const ROOT = fileURLToPath(new URL('.', import.meta.url));

function page(name: string): string {
  return readFileSync(join(ROOT, name), 'utf8');
}

const form = () => page('Form.tsx');
const affiliate = () => page('Affiliate.tsx');
const webinar = () => page('Webinar.tsx');

/**
 * 直しを戻したときの赤化確認用。ふだんは作業ツリーの Form.tsx を読むが、
 * `FORM_SRC=/tmp/旧Form.tsx` を付けると指定された中身を読む。
 * (stash 禁止のため、作業ツリーを汚さず `git show HEAD:...` の書き出しで確かめる)
 */
const formSrc = () => {
  const override = process.env.FORM_SRC;
  return override ? readFileSync(override, 'utf8') : form();
};

describe('回答フォームは直し方を欄のすぐ下に出す (4-a)', () => {
  it('欄ごとの直し方を持ち、欄の下へ渡す', () => {
    const src = form();
    expect(src).toContain('fieldErrors');
    expect(src).toContain('validateVisible');
    expect(src).toContain('error={');
    expect(src).toContain('欄のすぐ下');
  });

  it('直したらその欄の直し方を消す', () => {
    const src = form();
    expect(src).toContain('clearFieldError');
    // 値を変える3か所 (入力・チェック・画像) すべてで消す
    expect(src.match(/clearFieldError\(name\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('進む操作は下の帯にだけ置く', () => {
    const src = form();
    expect(src).toContain('<BottomBar>');
    expect(src).toContain('pb-28');
  });

  it('送信した・受付外は中央寄せの状態で出す', () => {
    const src = form();
    expect(src).toContain('送信しました');
    expect(src).toContain('いま回答を受け付けていません');
    expect(src.match(/<StatusView/g)?.length ?? 0).toBe(2);
  });
});

describe('回答フォームの動きは変えない', () => {
  it('送信の決めごと (冪等・確認・送り直し) が残る', () => {
    const src = form();
    expect(src).toContain('sendFlow');
    expect(src).toContain('decideFormSubmitStep');
    expect(src).toContain('resendWithFreshKey');
    expect(src).toContain('confirmDialog');
  });

  it('ページの進み・戻り (分岐つき) が残る', () => {
    const src = form();
    expect(src).toContain('nextSectionIndex');
    expect(src).toContain('goNext');
    expect(src).toContain('goBack');
  });
});

describe('マイル・紹介は中身を全部残し、6-mile の順に並べる', () => {
  it('並びは「貯まった → 増やす → 紹介の成果」', () => {
    const src = affiliate();
    const order = [
      '<MileageSummaryCard',
      '<MileageOpportunities',
      '<MileageHistory',
      '<ReferralSummary',
      'aria-label="参加中の案件"',
      'aria-label="参加できる案件"',
      'aria-label="その他のリンク"',
    ].map((mark) => src.indexOf(mark));
    for (const pos of order) expect(pos).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('貯まったマイル (使える・確定待ち・内訳4つ・合算の注記) がある', () => {
    const src = affiliate();
    expect(src).toContain('使えるマイル');
    expect(src).toContain('確定待ち');
    expect(src).toContain('これまでに得た');
    expect(src).toContain('紹介で得た');
    expect(src).toContain('使った');
    expect(src).toContain('良質な紹介');
    expect(src).toContain('合算しています');
  });

  it('増やす (取り組み・登録マイル・履歴) と未登録のはじめるがある', () => {
    const src = affiliate();
    expect(src).toContain('今、マイルを増やせます');
    expect(src).toContain('LINEアカウント登録マイル');
    expect(src).toContain('マイル履歴');
    expect(src).toContain('はじめる（無料）');
    expect(src).toContain('紹介リンクを使う');
  });

  it('紹介の成果 (数・参加中とリンク・参加できる・その他) がある', () => {
    const src = affiliate();
    expect(src).toContain('紹介の成果');
    expect(src).toContain('開いた');
    expect(src).toContain('友だち追加');
    expect(src).toContain('成果になった');
    expect(src).toContain('コピー');
    expect(src).toContain('リンクを発行');
    expect(src).toContain('20本まで');
    expect(src).toContain('審査中');
  });

  it('取り回し (登録・発行・参加・写し) の口が残る', () => {
    const src = affiliate();
    for (const fn of [
      'fetchMe',
      'postRegister',
      'postAddLink',
      'fetchOffers',
      'fetchMileage',
      'postEnrollOffer',
      'copyText',
    ]) {
      expect(src).toContain(fn);
    }
  });

  it('二重押し防止 (登録・参加) が残る', () => {
    const src = affiliate();
    expect(src).toContain('registerCalledRef');
    expect(src).toContain('enrollCalledRef');
  });

  it('旧い af-* の箱を使わない', () => {
    expect(affiliate()).not.toContain('af-');
  });
});

describe('回答フォーム3点 (m11c: 必須は琥珀・白い帯と説明・送信する)', () => {
  it('必須は琥珀の小さな太字。赤は入力の失敗だけに残す', () => {
    const src = formSrc();
    // 必須の印は待ちの札と同じ琥珀 (設計 #94600a) の小さな太字
    expect(src).toMatch(/function RequiredMark[\s\S]*?text-wait-ink/);
    expect(src).toContain('<RequiredMark />');
    // 必須に失敗の赤を渡さない
    expect(src).not.toMatch(/<RequiredMark[^/]*color/);
    // 入力の失敗 (欄の下の直し方・枠) はお店のテーマの error のまま
    expect(src).toContain('errorColor={theme.error}');
  });

  it('題名は白い上の帯に、その下に説明を出す', () => {
    const src = formSrc();
    expect(src).toContain('options.pageTitle');
    // 上の帯: 白地・下の hairline・画面いっぱい (設計 4-a)
    expect(src).toContain('bg-canvas');
    expect(src).toContain('border-b border-hairline');
    expect(src).toContain('-mx-4 -mt-4');
    // 帯の下の説明 (例「3分ほどで終わります」)
    expect(src).toContain('form.description');
  });

  it('送信は「送信する」。管理画面で決めた名前があればそれを使う', () => {
    const src = formSrc();
    expect(src).toContain('submitLabelText(options.submitLabel)');
    expect(src).toContain('送信する');
    // 旧い既定の「送信」は決めていない扱いで「送信する」にする
    expect(src).toContain("!== '送信'");
  });

  it('背景は決めた色だけ。決めていなければ殻の灰色のまま', () => {
    const src = formSrc();
    expect(src).toContain('hasCustomTheme');
    expect(src).toContain('options.theme !== undefined');
    expect(src).toContain('backgroundColor: hasCustomTheme ? theme.sub : undefined');
    expect(src).toContain('bg-ground');
  });
});

describe('ウェビナーは暗い地のまま (7-webinar)、時刻の同期はそのまま', () => {
  it('同期・補正・ハートビート・計測が残る', () => {
    const src = webinar();
    expect(src).toContain('expectedPosition');
    expect(src).toContain('DRIFT_TOLERANCE');
    expect(src).toContain('HEARTBEAT_MS');
    expect(src).toContain('webinarHeartbeat');
    expect(src).toContain('webinarCtaClick');
    expect(src).toContain('webinarComment');
  });

  it('地は暗く、ボタンと送信は濃い緑', () => {
    const src = webinar();
    expect(src).toContain('bg-night');
    expect(src).toContain('bg-accent-deep');
  });

  it('残り時間は箱で大きく出す (分・秒)', () => {
    const src = webinar();
    expect(src).toContain('remainSec');
    expect(src).toContain("unit: '分'");
    expect(src).toContain("unit: '秒'");
    expect(src).toContain('role="timer"');
  });

  it('主な状態 (待機・ライブ・終了・友だち追加前・再生できない・失敗) がある', () => {
    const src = webinar();
    expect(src).toContain('次回の開催は未定です');
    expect(src).toContain('ご視聴ありがとうございました');
    expect(src).toContain('友だち追加すると見られます');
    expect(src).toContain('この端末では再生できません');
    expect(src).toContain('読み込めませんでした');
  });

  it('会話はほか・自分を文字色で分ける', () => {
    const src = webinar();
    expect(src).toContain('text-night-name');
    expect(src).toContain('text-night-mine');
  });
});
