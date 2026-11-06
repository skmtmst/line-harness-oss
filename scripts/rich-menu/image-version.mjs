/** 保存済みの画像を保つため、内容を変えた画像は新しい保存先の版を使う。 */
export function assertInitialImageVersion(previous,version,images) {
 if(previous?._version===version&&Object.keys(images).some(style=>previous[style]!==images[style]))throw new Error('画像を変更する時は INITIAL_MENU_VERSION を上げてください');
}
