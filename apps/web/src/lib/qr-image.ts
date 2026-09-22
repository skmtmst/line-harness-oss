/*
  PERF-09: `qrcode` は QR を画面へ出す瞬間にだけ読む。静的 import に
  すると QR を一度も開かない訪問の初期バンドルへも入るため、ここを
  通して表示時に動的 import する。一度読んだら同じ Promise を使い回し、
  2枚目以降は待たせない。
*/
import type { QRCodeToDataURLOptions } from 'qrcode'

type QrCodeModule = typeof import('qrcode')

let loading: Promise<QrCodeModule> | null = null

function loadQrCode(): Promise<QrCodeModule> {
  loading ??= import('qrcode').then((mod) => {
    // CJS モジュールなので束ね方によっては default に入る。
    const resolved = mod as QrCodeModule & { default?: QrCodeModule }
    return resolved.default ?? resolved
  })
  return loading
}

export async function qrToDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string> {
  const QR = await loadQrCode()
  return QR.toDataURL(text, options)
}
