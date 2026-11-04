// 内部から自分の公開入口を読み戻さず、実装の依存先を直接読む。
export { IMAGE_METADATA_PREFIX_BYTES, imageDimensions, stripImageMetadata } from './media-metadata.js';
export { scanSingleMediaUsage } from './media-usage-scan.js';
export { findDirectMediaUsages } from './direct-media-usages.js';
export type { DirectMediaUsage } from './direct-media-usages.js';
