/*
 * 名前からアイコンに出す1文字を作る共通の関数。
 *
 * 会社名の頭が「株式会社」などの法人格だと、どの会社も同じ「株」になってしまう。
 * 先頭の空白・記号と法人格を飛ばしてから、最初の1文字を取る。
 * 「株式会社 然」→「然」、「Shed Products株式会社」→「S」。
 */

const CORPORATE_PREFIXES = [
  '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
  '特定非営利活動法人', '社会福祉法人', '医療法人', '学校法人', '宗教法人',
  '独立行政法人', '株式会社', '有限会社', '合同会社', '合名会社', '合資会社',
  '相互会社', '（株）', '(株)', '㈱', '（有）', '(有)', '㈲',
]

/* 先頭に付く空白・句読点・記号。絵文字は「1文字目」として残す。 */
const LEADING_SIGNS = /^[\s\u3000\u3001\u3002\uff0c\uff0e.,:;!?'"`~\-_/\\|#*+<>{}\[\]()\uff08\uff09\u300c\u300d\u300e\u300f\u3010\u3011\u3008\u3009\u300a\u300b\u3014\u3015\u2026\u2014\u2013\u30fb]+/u
const TRAILING_SPACE = /\s+$/u

function stripLeadingSigns(value: string): string {
  return value.replace(LEADING_SIGNS, '')
}

/** 法人格を飛ばした、表示に使う名前。空なら元の名前を返す。 */
export function nameInitial(name: string): string {
  const original = name.trim()
  if (!original) return ''

  let rest = original.replace(/^[\s\u3000]+/u, '')
  // 法人格・先頭の記号が続く場合（「・株式会社 有限会社 ○○」など）も飛ばす。
  let changed = true
  while (changed && rest) {
    changed = false
    const withoutSpace = rest.replace(/^[\s\u3000]+/u, '')
    for (const prefix of CORPORATE_PREFIXES) {
      if (withoutSpace.startsWith(prefix)) {
        rest = withoutSpace.slice(prefix.length).replace(/^[\s\u3000]+/u, '')
        changed = true
        break
      }
    }
    if (changed) continue
    const stripped = stripLeadingSigns(rest)
    if (stripped !== rest) {
      rest = stripped
      changed = true
    }
  }

  // 後ろに付く法人格（「然 株式会社」）も外す。
  const withoutTail = rest.replace(/(?:一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|社会福祉法人|医療法人|学校法人|宗教法人|独立行政法人|株式会社|有限会社|合同会社|合名会社|合資会社|相互会社|（株）|\(株\)|㈱|（有）|\(有\)|㈲)\s*$/u, '')
  const head = stripLeadingSigns(withoutTail).replace(TRAILING_SPACE, '')

  // 法人格だけの名前でも空にしない。
  return [...(head || original)][0] ?? ''
}
