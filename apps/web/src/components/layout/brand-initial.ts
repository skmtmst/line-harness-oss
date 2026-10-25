import { nameInitial } from '@/lib/name-initial'

/*
 * アイコンに出す1文字。会社名の頭が「株式会社」などの法人格だと、どの
 * 会社も同じ「株」になってしまうので、そこを外してから1文字目を取る。
 * 特定の契約先の名前は書かない。
 *
 * 頭文字の決め方は `@/lib/name-initial` が持ち、会社の印・
 * アカウントのアイコン・人のアバターで同じものを使う。
 */
export function brandInitial(name: string): string {
  return nameInitial(name)
}
