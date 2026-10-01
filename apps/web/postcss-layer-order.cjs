/*
 * 層の順番を、部品の CSS Module の先頭で宣言する（検証環境 2026-10-02）。
 *
 * 共通部品の CSS Module は `@layer components` に入っている（#718）。
 * Tailwind v4 の出力は層の順番を先頭で宣言しないので、部品の CSS が
 * globals.css より先に読まれると、最初に現れた components が1番目の層になり、
 * 後から来る base（preflight）が部品に勝つ。ボタンの地・枠・余白、
 * 入力欄の枠、カードの余白が全部消えた。どの CSS が先に読まれるかは
 * ビルドごとに変わるので、ここで毎回そろえる。
 *
 * ★V8 の部品に積み替え終わり、`@layer components` を使う CSS Module が
 * 無くなったら、このファイルと postcss.config.mjs の1行を消してよい。
 */
const ORDER = 'properties, theme, base, components, utilities'

const plugin = () => ({
  postcssPlugin: 'lh-layer-order',
  Once(root, { AtRule }) {
    const file = root.source?.input?.file ?? ''
    if (!file.endsWith('.module.css')) return
    let usesComponents = false
    root.walkAtRules('layer', (rule) => {
      if (rule.params.trim() === 'components' && rule.nodes) usesComponents = true
    })
    if (!usesComponents) return
    root.prepend(new AtRule({ name: 'layer', params: ORDER }))
  },
})
plugin.postcss = true
plugin.ORDER = ORDER

module.exports = plugin
