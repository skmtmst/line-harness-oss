/*
 * アイコンに出す1文字。会社名の頭が「株式会社」などの法人格だと、どの
 * 会社も同じ「株」になってしまうので、そこを外してから1文字目を取る。
 * 特定の契約先の名前は書かない。
 *
 * 画面部品から切り離してここに置く。左メニューの試験は
 * `sidebar-identity` を差し替えて動かすので、そこに置くと
 * 頭文字だけ使いたい側から読めなくなる。
 */
const CORPORATE_PREFIXES = [
  '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
  '特定非営利活動法人', '社会福祉法人', '医療法人', '学校法人', '宗教法人',
  '独立行政法人', '株式会社', '有限会社', '合同会社', '合名会社', '合資会社',
  '相互会社',
]

export function brandInitial(name: string): string {
  const trimmed = name.trim()
  for (const prefix of CORPORATE_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length).trimStart()
      // 「株式会社」だけのときは外さない（空の丸になる）。
      if (rest) return [...rest][0]
    }
    if (trimmed.endsWith(prefix)) {
      const rest = trimmed.slice(0, -prefix.length).trimEnd()
      if (rest) return [...rest][0]
    }
  }
  return [...trimmed][0] ?? ''
}
