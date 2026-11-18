// Copies every file under `from` into `to`, creating directories as needed, and stops on a file
// that already exists instead of overwriting it. cpSync's errorOnExist can't do this: since
// Node 24.22 it also refuses a directory that already exists.

import { constants, copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

/** @param {string} from  @param {string} to */
export function copyNewFiles(from, to) {
  for (const entry of readdirSync(from, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const source = join(entry.parentPath, entry.name)
    const target = join(to, relative(from, source))
    mkdirSync(dirname(target), { recursive: true })
    try {
      copyFileSync(source, target, constants.COPYFILE_EXCL)
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`${target} already exists: ${source} would overwrite it`)
      throw error
    }
  }
}
