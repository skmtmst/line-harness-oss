'use client'
import ConversionCreateV8 from '@/v8/conversions/create'



/*
 * 入口：★V8 は src/v8 に一から書いた作る画面（・）。管理画面 の画面は下のまま。
 * 先に分けるので、V8 のときに 管理画面 の画面の読み込み（同名の確認・使う場所の候補）は走らない。
 */
export default function NewConversionPointPage() {

  return <ConversionCreateV8 />
}
