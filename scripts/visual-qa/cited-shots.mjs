/*
  **台帳と引き継ぎ書が名指しする絵を集める。**

  PNG は版から外す（`.gitignore`）。作り直せるうえ、履歴を 528MB 太らせていた。
  ただし**判定の出典として名指しされている絵だけは残す**。
  名指ししたのに版に無いと、判定の根拠をあとから確かめられない。

  ここが唯一の名簿。`.gitignore` に例外を書き並べる形にしなかったのは、
  新しい判定を書くたびに例外を足し忘れ、**静かに漏れる**ため。
  代わりに `cited-shots.test.ts` が「名指ししたものが版にあるか」を見る。
*/
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * `機能-v6/ノード-1440.png` の形だけを拾う。
 *
 * **`.png` の直後で終わるものだけ。** 引き継ぎ書の中に
 * `design-reference/dashboard-v5/01-dashboard-1920.png/fJ2hc.png` という
 * 壊れた道が書いてあり、前半を絵の名前として拾ってしまっていた。
 * その名前の絵は存在しないので、「名指しなのに無い」が5件も水増しされた。
 */
const SHOT = /[A-Za-z0-9_-]+-v[0-9]\/[A-Za-z0-9_-]+\.png(?![/\w])/g

function collect(text, into) {
  for (const hit of text.match(SHOT) ?? []) into.add(hit)
}

function walkMarkdown(dir, into) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walkMarkdown(path, into)
    else if (entry.name.endsWith('.md')) collect(readFileSync(path, 'utf8'), into)
  }
}

/**
 * 名指しされている絵を、`<機能>-v6/<名前>.png` の形で返す。
 *
 * 置き場は2つある（実装は `docs/design-qa`、設計は `docs/design-reference`）。
 * どちらに在るかは名前からは決まらないので、ここでは付けない。
 */
export function citedShots() {
  const found = new Set()
  collect(readFileSync(join(ROOT, 'scripts', 'visual-qa', 'screens.mjs'), 'utf8'), found)
  walkMarkdown(join(ROOT, 'docs'), found)
  return [...found].map((x) => x.replace(/^docs\/design-(qa|reference)\//, '')).sort()
}

if (process.argv[1] && process.argv[1].endsWith('cited-shots.mjs')) {
  for (const shot of citedShots()) console.log(shot)
}
