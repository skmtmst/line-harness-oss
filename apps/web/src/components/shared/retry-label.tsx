'use client'

/*
 * ：v8 の絵の失敗の文は「読み込めませんでした」「もう一度試す」。
 * 表の中の失敗の行・数のカードの再試しなど、フックを持たない部品から使う。
 */
export function RetryLabel() {
  return <>もう一度読み込む</>
}

export function FailureTitle({ title }: { title: string }) {

  return <>{title.replace(/表示できませんでした$/, '読み込めませんでした')}</>
}
