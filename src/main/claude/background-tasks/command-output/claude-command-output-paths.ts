// Where Claude Code writes a shell task's output: <tmp root>/<project bucket>/<session id>/tasks/<task id>.output.
// The layout is internal to Claude Code (measured on 2.1.326), so every route here is checked against the
// per-user tmp root and a miss means "no live output", never an error.

import { lstat, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, sep } from 'node:path'

/** Claude Code's task ids and tool-call ids; anything else never names a file. */
const COMMAND_OUTPUT_ID = /^[A-Za-z0-9_-]{1,128}$/
// Claude Code cuts a longer encoded cwd to 200 characters and appends a hash of the full path.
const CLAUDE_BUCKET_NAME_MAX_LENGTH = 200

export function isClaudeCommandOutputId(value: unknown): value is string {
  return typeof value === 'string' && COMMAND_OUTPUT_ID.test(value)
}

export type ClaudeCommandOutputRootInput = {
  /** The launch environment's CLAUDE_CODE_TMPDIR, when the child was given one. */
  tmpDir?: string
  platform?: NodeJS.Platform
  uid?: number
}

/**
 * The real path of `claude-<uid>` under Claude Code's tmp base, or null where the layout is unverified.
 * Why Windows is excluded: Claude Code's Windows tmp base and uid naming were not measured, so we do not guess.
 */
export async function claudeCommandOutputRoot(
  input: ClaudeCommandOutputRootInput
): Promise<string | null> {
  const platform = input.platform ?? process.platform
  const uid = input.uid ?? process.getuid?.()
  if (platform === 'win32' || uid === undefined) {
    return null
  }
  const base = input.tmpDir && isAbsolute(input.tmpDir) ? input.tmpDir : '/tmp'
  const root = join(base, `claude-${uid}`)
  try {
    // /tmp is shared: trust only a real folder this user owns, as Claude Code creates it.
    const stats = await lstat(root)
    if (!stats.isDirectory() || stats.uid !== uid) {
      return null
    }
    return await realpath(root)
  } catch {
    return null
  }
}

/** Same bucket rule as Claude Code's project folders: one dash per non-alphanumeric character. */
function encodeClaudeBucketName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Candidate `tasks` folders computed from the launch cwd; a long cwd matches its hashed bucket by prefix. */
export async function computedClaudeTaskDirs(
  root: string,
  cwd: string,
  providerSessionId: string
): Promise<string[]> {
  if (!isClaudeSessionIdSegment(providerSessionId)) {
    return []
  }
  const cwds = new Set([cwd])
  try {
    cwds.add(await realpath(cwd))
  } catch {
    // A vanished cwd keeps only its launch spelling.
  }
  const dirs: string[] = []
  let entries: string[] | null = null
  for (const candidate of cwds) {
    const encoded = encodeClaudeBucketName(candidate)
    if (encoded.length <= CLAUDE_BUCKET_NAME_MAX_LENGTH) {
      dirs.push(join(root, encoded, providerSessionId, 'tasks'))
      continue
    }
    entries ??= await readdir(root).catch(() => [])
    const prefix = `${encoded.slice(0, CLAUDE_BUCKET_NAME_MAX_LENGTH)}-`
    for (const entry of entries) {
      if (entry === encoded || entry.startsWith(prefix)) {
        dirs.push(join(root, entry, providerSessionId, 'tasks'))
      }
    }
  }
  return dirs
}

function isClaudeSessionIdSegment(value: string): boolean {
  return /^[A-Za-z0-9-]{1,128}$/.test(value)
}

/** Whether a path names `<taskId>.output` directly inside a folder called `tasks`. */
export function isClaudeTaskOutputPathShape(path: string, taskId: string): boolean {
  return (
    isAbsolute(path) && basename(path) === `${taskId}.output` && basename(dirname(path)) === 'tasks'
  )
}

/** Whether a `tasks` folder path has the shape Claude Code writes. */
export function isClaudeTaskDirShape(path: string): boolean {
  return isAbsolute(path) && basename(path) === 'tasks'
}

function isInside(root: string, path: string): boolean {
  return path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

/** The candidate, if it is a regular file (not a link) whose real path stays inside the tmp root. */
export async function verifiedClaudeTaskOutputFile(
  root: string,
  candidate: string,
  taskId: string
): Promise<string | null> {
  if (!isClaudeTaskOutputPathShape(candidate, taskId)) {
    return null
  }
  try {
    const stats = await lstat(candidate)
    if (!stats.isFile()) {
      return null
    }
    const real = await realpath(candidate)
    return isInside(root, real) && basename(real) === `${taskId}.output` ? real : null
  } catch {
    return null
  }
}

/** The folder's real path when it stays inside the tmp root. */
export async function verifiedClaudeTaskDir(root: string, dir: string): Promise<string | null> {
  if (!isClaudeTaskDirShape(dir)) {
    return null
  }
  try {
    const real = await realpath(dir)
    return isInside(root, real) && basename(real) === 'tasks' ? real : null
  } catch {
    return null
  }
}
