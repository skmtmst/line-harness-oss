/** CSS解析のライブラリ。固定の設計値を合否に使わない。 */
/* ---------- 値の正規化 ---------------------------------------------------
 * ビルドは `#ffffff` を `#fff`、`0.5rem` を `.5rem` に縮める。
 * 書き方の違いで落ちないよう、比べる前にそろえる。
 */
export function normalize(value) {
  let v = String(value).trim().toLowerCase().replace(/\s+/g, ' ')
  v = v.replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/g, '#$1$1$2$2$3$3')
  v = v.replace(/(^|[\s(,])\.(\d)/g, '$10.$2')
  v = v.replace(/\s*,\s*/g, ',')
  // CSSの最適化は rgba と8桁hexを相互に変える。色は8bitへそろえ、書式だけの違いで落とさない。
  v = v.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/g, (all, r, g, b, a = '1') => {
    const channels = [Number(r), Number(g), Number(b), Math.round(Number(a) * 255)]
    if (channels.some((c) => !Number.isFinite(c) || c < 0 || c > 255)) return all
    return '#' + channels.map((c) => c.toString(16).padStart(2, '0')).join('')
  })
  v = v.replace(/#([0-9a-f]{6})ff\b/g, '#$1')
  return v
}

/* ---------- CSSの読み取り ------------------------------------------------ */

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/*
 * `@media`・`@container`・`@scope`・`@keyframes` の中身を取り除く。
 *
 * これらは別の状態（タッチ端末・狭い画面）の宣言で、hover と同じく
 * 基準状態ではない。#976 でタッチ端末向けの `@media (pointer: coarse)`
 * （高さ44px・文字16px）が部品に入ったとき、内側の宣言が基準状態の
 * 値として拾われて「不一致」になった。`@layer`/`@supports` は中身が
 * 基準状態の宣言そのものを持つことがあるので残す。
 */
function stripConditionalBlocks(css) {
  const re = /@(media|container|scope|keyframes)\b/gi
  let out = ''
  let last = 0
  let m
  while ((m = re.exec(css))) {
    const open = css.indexOf('{', m.index)
    if (open === -1) break
    out += css.slice(last, m.index)
    let depth = 0
    let j = open
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') {
        depth--
        if (depth === 0) {
          j++
          break
        }
      }
    }
    last = j
    re.lastIndex = j
  }
  return out + css.slice(last)
}

/** `.card{...}` の中身を取り出す。クラス名は完全一致。 */

/**
 * ビルド後は `.summary-card_card__A1b2` のようにハッシュが付く。
 *
 * CSS最適化は、同じ宣言を持つクラスを
 * `.breadcrumb_root__A,.sticky_actions__B{display:flex;gap:8px}` のように
 * 1つへ束ねる。単独セレクタだけを探すと、実際には配信されている宣言を
 * 「宣言なし」と誤判定するため、カンマ区切りのセレクタも読む。
 */
export function builtRuleBody(css, prefix, cls, selector) {
  // hover・[hidden]・子孫指定は別状態なので、基準状態の完全一致だけを拾う。
  // @media などの条件付きブロックも同じ理由で先に除く。
  css = stripConditionalBlocks(css)
  const escaped = `${prefix}_${cls}__`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const target = new RegExp(`^\\.${escaped}[A-Za-z0-9_-]+$`)
  const selectorKey = (value) => value.trim().replace(/\[([^\]=]+)=["']([^"']+)["']\]/g, '[$1=$2]')
    .replace(/\s*>\s*\*?/g, '>').replace(/\s+/g, ' ')
  const moduleClass = new RegExp(`\\.${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_([A-Za-z0-9_-]+?)__[A-Za-z0-9_-]+`, 'g')
  const re = /([^{}]+)\{([^{}]*)\}/g
  const bodies = []
  let m
  while ((m = re.exec(css))) {
    if (m[1].split(',').some((actual) => selector
      ? selectorKey(actual.replace(moduleClass, '.$1')) === selectorKey(selector)
      : target.test(actual.trim()))) bodies.push(m[2])
  }
  return bodies.join(';')
}

export function resolveVars(value, vars, depth = 0) {
  if (depth > 8 || !value.includes('var(')) return value
  const next = value.replace(/var\(\s*--([a-z0-9-]+)\s*(?:,[^)]*)?\)/gi, (whole, name) =>
    name in vars ? vars[name] : whole,
  )
  return next === value ? value : resolveVars(next, vars, depth + 1)
}

/** 現在の実効値を宣言順で読む。clsは同じ要素に付く合成クラス。 */
export function v8EffectiveBody(css, cls) {
  return frozenSelectorBody(css, (Array.isArray(cls) ? cls : [cls]).map(c => '.' + c).join(''))
}

/** 固定HTMLの色・選択状態の照合。同じ要素の合成クラスとv8上書きだけを読む。 */
export function frozenSelectorBody(css, selector) {
  const clean = s => s.trim().replace(/^(?:(?:html)?:root|:global\(:root\)|(?:html)?\[data-theme=["']?v8["']?\])\s+/, '').replace(/["']/g, '')
  const wanted = clean(selector)
  const classes = [...wanted.matchAll(/\.([\w-]+)/g)].map(m => m[1])
  const rest = wanted.replace(/\.[\w-]+/g, '')
  const bodies = []
  for (const m of stripConditionalBlocks(stripComments(css)).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const match = m[1].split(',').some(raw => {
      const sel = clean(raw)
      if (/\s|>|\+|~/.test(sel)) return false
      const used = [...sel.matchAll(/\.([\w-]+)/g)].map(m => m[1])
      const suffix = sel.replace(/\.[\w-]+/g, '')
      return used.length > 0 && used.every(cls => classes.includes(cls)) && (suffix === '' || suffix === rest)
    })
    if (match) bodies.push(m[2])
  }
  return bodies.join(';')
}

if (process.argv[1] && process.argv[1].endsWith('verify-design-values.mjs')) {
  throw new Error('固定した設計値の実行検査は廃止しました。崩れ検査は v8-guard/layout-defects.mjs を使います')
}
