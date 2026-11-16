// 内置素材库：读清单、把素材拷进工程（放在工程的 library/ 下，影片引用工程里的副本）。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { HOME } from './project.mjs';

export const LIB = path.join(HOME, 'library');

export function libraryManifest() {
  return JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8'));
}

// → 工程里的相对路径
export async function addToProject(root, id) {
  const item = libraryManifest().items.find((i) => i.id === id);
  if (!item) throw new Error(`素材库里没有 ${id}`);
  const rel = `library/${item.file}`;
  const dest = path.join(root, rel);
  if (!fs.existsSync(dest)) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(path.join(LIB, item.file), dest);
  }
  return { item, file: rel };
}
