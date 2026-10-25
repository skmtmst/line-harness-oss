import postcss from 'postcss'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { compile } from 'tailwindcss'

/** Happy DOM が未対応のレイヤーだけを外し、実際の宣言をDOMに適用する。 */
export async function installSharedStyles(modules: Array<[string, Record<string, string>]>, utilities: string[] = []) {
  const require = createRequire(import.meta.url)
  const base = join(__dirname, '../../app')
  const compiler = await compile(readFileSync(join(base, 'globals.css'), 'utf8').replace('@theme {', '@theme static {'), {
    base,
    loadStylesheet: async (id, from) => {
      const file = id.startsWith('.') ? resolve(from, id) : require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id)
      return { path: file, base: dirname(file), content: readFileSync(file, 'utf8') }
    },
  })
  const root = postcss.parse(compiler.build(utilities))
  const flattenLayers = (css: postcss.Root) => {
    css.walkAtRules('layer', rule => { if (rule.nodes) rule.replaceWith(rule.nodes); else rule.remove() })
  }
  flattenLayers(root)
  for (const [name, classes] of modules) {
    const compiler = await compile(readFileSync(join(__dirname, `${name}.module.css`), 'utf8'))
    const css = postcss.parse(compiler.build([]))
    css.walkRules(rule => {
      rule.selector = rule.selector.replace(/\.([a-zA-Z_][\w-]*)/g, (match, name: string) => classes[name] ? `.${classes[name]}` : match)
    })
    flattenLayers(css)
    root.append(css.nodes)
  }
  const style = document.createElement('style')
  style.textContent = root.toString()
  document.head.append(style)
  return () => style.remove()
}

/** 描画された文字と背景の実効色を、白い画面に重ねて比較する。 */
export function contrastRatio(foreground: string, background: string): number {
  const rgb = (color: string): number[] => {
    const values = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)
      ? [...[1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)), color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1]
      : color.match(/[\d.]+/g)?.map(Number)
    if (!values || values.length < 3) throw new Error(`色を解釈できません: ${color}`)
    const alpha = values[3] ?? 1
    return values.slice(0, 3).map(value => value * alpha + 255 * (1 - alpha))
  }
  const luminance = (color: string) => {
    const [r, g, b] = rgb(color).map(value => {
      const channel = value / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
