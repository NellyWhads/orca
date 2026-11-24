import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { ClaudeTaskOutputFile } from './claude-command-output-paths'

/** One read's ceiling, so a fast writer cannot make a single reply large. */
export const COMMAND_OUTPUT_CHUNK_BYTES = 64 * 1024
/** A first read of a long file starts this far from its end; older output stays on disk. */
export const COMMAND_OUTPUT_FIRST_READ_TAIL_BYTES = 1024 * 1024
/** A reader this far behind a fast writer jumps to its last chunk instead of replaying the backlog. */
export const COMMAND_OUTPUT_LAG_SKIP_BYTES = 2 * 1024 * 1024

export type ClaudeCommandOutputChunk = {
  text: string
  offset: number
  more: boolean
  skippedBytes?: number
  reset?: true
}

/** Bytes of an incomplete UTF-8 sequence at the end, held back until the rest arrives. */
export function incompleteUtf8Tail(bytes: Uint8Array): number {
  // A sequence is at most 4 bytes; look back over at most 3 continuation bytes to its lead.
  for (let back = 1; back <= Math.min(4, bytes.length); back++) {
    const byte = bytes[bytes.length - back]
    if ((byte & 0xc0) === 0x80) {
      continue
    }
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
    return length > back ? back : 0
  }
  return 0
}

/** Continuation bytes at the start, left behind when a read starts mid-character. */
export function leadingContinuationBytes(bytes: Uint8Array): number {
  let count = 0
  while (count < bytes.length && count < 3 && (bytes[count] & 0xc0) === 0x80) {
    count++
  }
  return count
}

export type CommandOutputReadWindow = {
  start: number
  length: number
  skippedBytes: number
  reset: boolean
}

/** Where a read from `offset` starts in a file of `size` bytes, and what it leaves out. */
export function commandOutputReadWindow(size: number, offset: number): CommandOutputReadWindow {
  const reset = offset > size
  let start = reset ? 0 : offset
  let skippedBytes = 0
  const backlog = size - start
  if (start === 0 && backlog > COMMAND_OUTPUT_FIRST_READ_TAIL_BYTES) {
    // A first read of a long file shows its recent history, not its beginning.
    skippedBytes = backlog - COMMAND_OUTPUT_FIRST_READ_TAIL_BYTES
  } else if (backlog > COMMAND_OUTPUT_LAG_SKIP_BYTES) {
    // Landing one chunk from the end lets the next read catch the writer instead of trailing it.
    skippedBytes = backlog - COMMAND_OUTPUT_CHUNK_BYTES
  }
  start += skippedBytes
  return { start, length: Math.min(COMMAND_OUTPUT_CHUNK_BYTES, size - start), skippedBytes, reset }
}

/** The chunk a read of `bytes` at `window` yields: whole characters only, the rest held for the next read. */
export function decodeCommandOutputBytes(
  bytes: Uint8Array,
  window: CommandOutputReadWindow,
  size: number
): ClaudeCommandOutputChunk {
  let start = window.start
  let skippedBytes = window.skippedBytes
  let view = bytes
  if (skippedBytes > 0) {
    const lead = leadingContinuationBytes(view)
    view = view.subarray(lead)
    skippedBytes += lead
    start += lead
  }
  const complete = view.subarray(0, view.length - incompleteUtf8Tail(view))
  return {
    text: Buffer.from(complete.buffer, complete.byteOffset, complete.byteLength).toString('utf8'),
    offset: start + complete.length,
    // Held-back bytes at the end of the file wait for their writer, not for another read.
    more: start + view.length < size,
    ...(skippedBytes > 0 ? { skippedBytes } : {}),
    ...(window.reset ? { reset: true as const } : {})
  }
}

/** Null when the file is missing or unreadable; `replaced` when its name now holds another file. */
export async function readClaudeCommandOutputChunk(
  file: ClaudeTaskOutputFile,
  offset: number
): Promise<ClaudeCommandOutputChunk | 'replaced' | null> {
  let handle
  try {
    // O_NOFOLLOW refuses a swapped-in link and O_NONBLOCK a swapped-in FIFO; the identity check does the rest.
    handle = await open(
      file.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    )
  } catch {
    return null
  }
  try {
    const stats = await handle.stat()
    if (!stats.isFile() || stats.nlink !== 1 || stats.dev !== file.dev || stats.ino !== file.ino) {
      return 'replaced'
    }
    const window = commandOutputReadWindow(stats.size, offset)
    const buffer = Buffer.alloc(Math.max(0, window.length))
    const { bytesRead } =
      window.length > 0
        ? await handle.read(buffer, 0, window.length, window.start)
        : { bytesRead: 0 }
    return decodeCommandOutputBytes(buffer.subarray(0, bytesRead), window, stats.size)
  } catch {
    return null
  } finally {
    await handle.close().catch(() => {})
  }
}
