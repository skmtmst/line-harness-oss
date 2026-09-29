import type { WebinarCtaCard } from '@/lib/api'

/*
 * CTAカードの保存前チェック。公開前検証（cta_range・https・フォーム実在）は
 * サーバー側に既にあるが、そこで弾かれてからでは「どのカードの何が
 * 足りないか」が分からない。保存を押す前に、不足箇所と直し方を枚数で示す。
 * 1件でもあれば保存は呼ばない。
 */
export function ctaCardProblems(
  ctas: WebinarCtaCard[],
  times: string[],
  durationSeconds: number,
  parseTime: (value: string) => number | null,
): string[] {
  const problems: string[] = []
  ctas.forEach((card, i) => {
    const label = `${i + 1}枚目`
    const at = parseTime(times[i] ?? '')
    if (at === null) {
      problems.push(`${label}: 表示時間が不正です（例: 45:00 または秒数）`)
    } else if (durationSeconds > 0 && at > durationSeconds) {
      problems.push(
        `${label}: 表示時間が動画の長さ（${Math.floor(durationSeconds / 60)}分）を超えています。動画の中の時刻に直してください`,
      )
    }
    if (!card.title?.trim()) {
      problems.push(`${label}: タイトルが空です。カードの見出しを入れてください`)
    }
    if (!card.buttonLabel?.trim()) {
      problems.push(`${label}: ボタンの文言が空です。ボタンに出す文字を入れてください`)
    }
    if (card.kind === 'form') {
      if (!card.formId) {
        problems.push(`${label}: フォームが選ばれていません。公開中のフォームを選ぶか、種類をURLへ変えてください`)
      }
    } else {
      const url = card.url?.trim() ?? ''
      if (!url) {
        problems.push(`${label}: URLが未入力です。https:// から始まるURLを入れてください`)
      } else if (!/^https:\/\//.test(url)) {
        problems.push(`${label}: URLは https:// で始めてください（httpは使えません）`)
      }
    }
  })
  return problems
}
