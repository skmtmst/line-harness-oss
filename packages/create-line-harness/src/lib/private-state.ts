import { constants, openSync, closeSync, fchmodSync, fstatSync, lstatSync, chmodSync, writeFileSync } from 'node:fs';

/** Secret-bearing setup progress belongs only to the installing OS user. */
export function writePrivateState(directory: string, path: string, contents: string): void {
  const dir = lstatSync(directory);
  if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.()) throw new Error('Unsafe setup directory');
  chmodSync(directory, 0o700);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.uid !== process.getuid?.() || file.nlink !== 1) throw new Error('Unsafe setup state');
    fchmodSync(fd, 0o600);
    // Truncate only after tightening existing file permissions.
    writeFileSync(fd, contents, { encoding: 'utf8' });
    // The descriptor form does not truncate an existing file.
    const { length } = Buffer.from(contents);
    truncate(fd, length);
  } finally { closeSync(fd); }
}
import { ftruncateSync as truncate } from 'node:fs';
