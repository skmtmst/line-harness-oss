/**
 * `apps/web/src/lib/api.ts` から「GETで**配列**が返る口」を読み出す。
 *
 * **なぜ手で並べないか。**
 * 一度、口の一覧を手で書き写して置いた。書き写しは増えた口に追いつかず、
 * 足りない口は `{items:[],total:0}` に落ちて、画面が
 * `xxx.filter is not a function` で真っ白になった。落ちた画面を見て
 * 1行ずつ足す作業が5画面ぶん残り、そこで止まっていた。
 *
 * 出どころは `api.ts` ひとつなので、**そこを読む**。写しは持たない。
 *
 * 見分け方は `fetchApi<ApiResponse<T>>('/path', { method })`:
 * - `method` が無ければ GET
 * - `T` が `X[]` か `Array<X>` なら配列
 * 同じパスに GET（一覧＝配列）と POST（作成＝1件）が並ぶことがあるので、
 * **GET だけを見る**。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API_TS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'web', 'src', 'lib', 'api.ts')

/** 対応する閉じ括弧の**次**の位置。入れ子を数えるだけ。 */
function matchEnd(text, from, open, close) {
  let depth = 1
  let i = from
  while (i < text.length && depth > 0) {
    if (text[i] === open) depth += 1
    else if (text[i] === close) depth -= 1
    i += 1
  }
  return i
}


/**
 * 書いてあるパスの、**変わらないところ**だけを取り出す。
 *
 * `/api/tags${params}` → `/api/tags`
 * `/api/friends?`      → `/api/friends`
 * `/api/friends/${id}/site-events` → **捨てる**
 *
 * 最後が `/` で終わるものを捨てるのが要点。捨てないと
 * `/api/friends/${id}/site-events` が `/api/friends` に化けて、
 * 1件ずつ返る口を配列の口として覚えてしまう。実際そうなって、
 * 友だち一覧が `undefined.toLocaleString()` で落ちた。
 */
function staticPath(literal) {
  const cut = literal.indexOf('${')
  const head = cut < 0 ? literal : literal.slice(0, cut)
  const base = head.split('?')[0]
  if (!base.startsWith('/api/')) return null
  // 途中で切れている（後ろにIDなどが続く）ものは、ここでは決められない
  if (base.endsWith('/')) return null
  return base
}

/**
 * これを下回ったら、読み取りが壊れたとみなして起動を止める。
 *
 * 黙って0件になると、全部の口が `{items:[],total:0}` に落ちる。
 * 画面は真っ白になるが、原因が「モックの読み取りが壊れた」ことだとは
 * どこにも出ない。**静かに壊れさせない。**
 */
const MINIMUM = 40

export function readArrayGetPaths(source = readFileSync(API_TS, 'utf8')) {
  const paths = new Set()
  let cursor = 0
  for (;;) {
    const found = source.indexOf('fetchApi<', cursor)
    if (found < 0) break
    const typeStart = found + 'fetchApi<'.length
    const typeEnd = matchEnd(source, typeStart, '<', '>')
    const type = source.slice(typeStart, typeEnd - 1).replace(/\s+/g, ' ').trim()

    const parenStart = source.indexOf('(', typeEnd)
    const parenEnd = matchEnd(source, parenStart + 1, '(', ')')
    const args = source.slice(parenStart + 1, parenEnd - 1)
    cursor = typeEnd

    const literal = /^\s*[`'"]([^`'"]*)/.exec(args)
    if (!literal) continue
    // `method:` が書いてなければ GET。一覧はどれも GET。
    if (/method:\s*'(?!GET)/.test(args)) continue

    /*
      `ApiResponse<X[]>` のほかに、**交差型**で書かれた口がある:
        fetchApi<ApiResponse<EcCommerceEvent[]> & { pagination: … }>('/api/ec-commerce/events')
      末尾が `}` になるので `^ApiResponse<…>$` には当たらず、この口だけ黙って
      一覧から抜けていた。抜けると `EMPTY_PAGE`（`{items:[],total:0}`）が返り、
      `/ec-commerce` が描画の途中で `events.map is not a function` を投げて
      **本文が丸ごと「画面を表示できませんでした」に置き換わる**。撮ると空の絵になる。
      `ApiResponse<` の対になる `>` を数えて中身を取り、その先が `&` で続くのは許す。
    */
    /*
      **`ApiResponse<X[]>` と書かない口がある。**
        fetchApi<{ data: Webinar[] }>(`/api/webinars…`)
      中身は `ApiResponse<Webinar[]>` と同じなのに、ここが名前しか見ていなかった
      ので拾えず、既定の器 `{items:[],total:0}` が返っていた。
      `/webinars` は `[...narrowed]` で **`narrowed is not iterable` を投げて
      画面が丸ごと「画面を表示できませんでした」になっていた**。
      ウェビナーの4つの口がこの書き方。両方を同じに扱う。
    */
    const bare = /^\{\s*data:\s*/.exec(type)
    if (!type.startsWith('ApiResponse<') && !bare) continue
    const prefix = bare ? bare[0] : 'ApiResponse<'
    const innerEnd = bare
      ? matchEnd(type, 0, '{', '}')
      : matchEnd(type, prefix.length, '<', '>')
    const inner = bare
      ? type.slice(prefix.length, innerEnd - 1).trim().replace(/;$/, '').trim()
      : type.slice(prefix.length, innerEnd - 1).trim()
    const rest = type.slice(innerEnd).trim()
    // 交差型（`& { … }`）だけを許す。知らない続きは形が決められないので見送る。
    if (rest && !rest.startsWith('&')) continue
    if (!inner.endsWith('[]') && !inner.startsWith('Array<')) continue

    const base = staticPath(literal[1])
    if (base) paths.add(base)
  }

  if (paths.size < MINIMUM) {
    throw new Error(
      `[visual-qa] api.ts から配列の口を ${paths.size} 件しか読めなかった（${MINIMUM} 件以上あるはず）。` +
      'api.ts の書き方が変わったか、この読み取りが壊れている。',
    )
  }
  return paths
}
