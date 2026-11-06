/**
 * R568: 手元の画像の縦横を、送る前に読む小さな部品。
 * 採用できない寸法はここで止めるので、R2 へ登録されない。
 * 手元で読めないときは null を返し、採用できる寸法の宣言を付けて送って
 * サーバ側で止める（サーバは宣言と違う寸法を登録しない）。
 */
export async function decodeImageSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const factory = (globalThis as { createImageBitmap?: unknown }).createImageBitmap as
      | ((file: File) => Promise<{ width: unknown; height: unknown; close?: () => void }>)
      | undefined
    if (typeof factory !== 'function') return null
    const bitmap = await factory(file)
    const size = typeof bitmap?.width === 'number' && typeof bitmap?.height === 'number'
      ? { width: bitmap.width, height: bitmap.height }
      : null
    try { bitmap?.close?.() } catch { /* 後片付けの失敗は無視する */ }
    return size
  } catch { return null }
}
