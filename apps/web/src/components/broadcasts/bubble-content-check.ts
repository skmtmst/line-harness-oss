/*
 * 一斉配信の吹き出し（Flex・カルーセル）が送れる形かの検査。
 *
 * R234: `{}` のような「JSON としては正しいが中身が無い」や `[{}]` のような
 * 「配列だが中身が空」も、保存・5段の帯・配信前検査で止める。判定は
 * broadcast-form.tsx の bubblesError（保存の検査と帯が同じ関数を見る）と、
 * worker の parseBroadcastMessageParts（保存側）で共有する考え。実在の確認
 * （テンプレートが本当に送れるか）は送る直前の検査に任せる。
 */

/**
 * カルーセルの中身が送れる形か。だめな理由、送れるなら null。
 *
 * 選んだテンプレートの中身は必ず 1 枚以上のパネル（キーを持つ object）なので、
 * キーを持たない要素は選び直しか壊れた写しとみなす。
 */
export function carouselColumnsProblem(columnsJson: unknown): string | null {
  const raw = String(columnsJson ?? '').trim()
  if (!raw) return 'カルーセルを選択してください'
  let columns: unknown
  try {
    columns = JSON.parse(raw)
  } catch {
    return 'カルーセルの中身を確認してください'
  }
  if (!Array.isArray(columns) || columns.length === 0) return 'カルーセルを選択してください'
  const broken = columns.some((column) =>
    !column || typeof column !== 'object' || Array.isArray(column) || Object.keys(column).length === 0,
  )
  if (broken) return 'カルーセルの中身を確認してください。空のパネルがあります'
  return null
}

/**
 * Flex（リッチメッセージ）の JSON が送れる形か。だめな理由、送れるなら null。
 *
 * 送れるのはバブルかカルーセルだけ。
 */
export function flexContentProblem(flexJson: unknown): string | null {
  const raw = String(flexJson ?? '').trim()
  if (!raw) return 'Flex JSONを入力してください'
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'Flex JSONを確認してください'
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'Flex JSONを確認してください'
  const type = (parsed as { type?: unknown }).type
  if (type !== 'bubble' && type !== 'carousel') return 'Flexはバブルかカルーセルの形にしてください'
  return null
}
