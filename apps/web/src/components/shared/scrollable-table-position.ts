/**
 * TBCUY の絵: 送り量250 / 最大958、つまみ移動120 / 最大336。
 * 先頭・この位置・末尾を結ぶ。比例バーでは絵の位置を再現できないため、
 * 2区間で補間し、ドラッグにはその逆関数を使う。幅が変わっても全域を送れる。
 */
const scrollAnchor = 250 / (1670 - 712)
const thumbAnchor = (416 - 296) / (696 - 360)

function interpolate(value: number, inputAnchor: number, outputAnchor: number) {
  const ratio = Math.max(0, Math.min(1, value))
  return ratio <= inputAnchor
    ? ratio / inputAnchor * outputAnchor
    : outputAnchor + (ratio - inputAnchor) / (1 - inputAnchor) * (1 - outputAnchor)
}

export function scrollToThumb(scroll: number, maximum: number, travel: number) {
  return maximum > 0 && travel > 0 ? interpolate(scroll / maximum, scrollAnchor, thumbAnchor) * travel : 0
}

export function thumbToScroll(left: number, maximum: number, travel: number) {
  return maximum > 0 && travel > 0 ? interpolate(left / travel, thumbAnchor, scrollAnchor) * maximum : 0
}
