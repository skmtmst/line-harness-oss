/*
 * 画面の契約試験のために、原文から**その一箇所だけ**を切り出す道具。
 *
 * ファイル全体を `toContain` で見ると、直したい行を消しても、直しの理由を
 * 書いた注釈や別の場所に同じ言葉が残っているだけで素通りする。実際に、
 * 見出しの「表示先」を外したのに、外した理由の注釈が同じ言葉を含むせいで
 * 既存の試験が通ってしまった。切り出してから見る。
 *
 * 試験からだけ使う。画面の描画には入らない。
 */

/** 注釈を落とす。注釈が本文の代わりに一致してしまうため。 */
export function withoutComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** `marker` の**後ろ**の最初の `open` から、対応する `close` までを切り出す。 */
export function balanced(source: string, marker: string, open = '{', close = '}'): string {
  const from = source.indexOf(marker)
  if (from < 0) throw new Error(`見つかりません: ${marker}`)
  const start = source.indexOf(open, from + marker.length)
  if (start < 0) throw new Error(`開き ${open} がありません: ${marker}`)
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === open) depth += 1
    else if (source[i] === close) {
      depth -= 1
      if (depth === 0) return withoutComments(source.slice(start, i + 1))
    }
  }
  throw new Error(`閉じ ${close} がありません: ${marker}`)
}

/** `<tag …>` から `</tag>` までを切り出す。 */
export function element(source: string, tag: string): string {
  const start = source.indexOf(`<${tag}`)
  const end = source.indexOf(`</${tag}>`)
  if (start < 0 || end < 0) throw new Error(`要素が見つかりません: ${tag}`)
  return withoutComments(source.slice(start, end))
}

/**
 * `start` から `end` の手前までを切り出す。
 *
 * JSXは `<` と `>` の数が合わないので、`balanced` では囲みを追えない。
 * 「どこからどこまで」を目印で挟む。
 */
export function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`見つかりません: ${start}`)
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`終わりが見つかりません: ${end}`)
  return withoutComments(source.slice(from, to))
}
