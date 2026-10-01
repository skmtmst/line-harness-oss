export default {
  plugins: {
    // 部品の CSS Module の先頭で層の順番を宣言する。★V8 移行が済んだら消す（中の説明を参照）。
    './postcss-layer-order.cjs': {},
    '@tailwindcss/postcss': {},
  },
}
