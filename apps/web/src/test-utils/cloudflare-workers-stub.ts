/*
 * 'cloudflare:workers' の vitest 用スタブ。
 *
 * packages/db の一部(資格情報の暗号鍵の読み出しなど)が Workers 実行時だけ
 * このモジュールから bindings を読む。Node/happy-dom の試験環境には存在
 * しないので、空の env を返す最小の実物を置く。読み出し側は try/catch で
 * 「無い環境」を許容する設計なので、空でよい。
 */
export const env: Record<string, string | undefined> = {}
