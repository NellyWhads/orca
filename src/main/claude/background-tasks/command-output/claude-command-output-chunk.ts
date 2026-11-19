import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { ClaudeTaskOutputFile } from './claude-command-output-paths'

/** One read's ceiling, so a fast writer cannot make a single reply large. */
export const COMMAND_OUTPUT_CHUNK_BYTES = 64 * 1024
/** A first read of a long file starts this far from its end; older output stays on disk. */
export const COMMAND_OUTPUT_FIRST_READ_TAIL_BYTES = 1024 * 1024
/** A reader this far behind a fast writer jumps to the tail instead of replaying the backlog. */
export const COMMAND_OUTPUT_LAG_SKIP_BYTES = 8 * 1024 * 1024

export type ClaudeCommandOutputChunk = {
  text: string
  offset: number
  more: boolean
  skippedBytes?: number
  reset?: true
}

/** Bytes of an incomplete UTF-8 sequence at the end, held back until the rest arrives. */
function incompleteUtf8Tail(bytes: Uint8Array): number {
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
function leadingContinuationBytes(bytes: Uint8Array): number {
  let count = 0
  while (count < bytes.length && count < 3 && (bytes[count] & 0xc0) === 0x80) {
    count++
  }
  return count
}

/**
 * Null when the file is missing or unreadable; `replaced` when the name now holds a different file than the one
 * verified, which the caller must verify again before reading.
 */
export async function readClaudeCommandOutputChunk(
  file: ClaudeTaskOutputFile,
  offset: number
): Promise<ClaudeCommandOutputChunk | 'replaced' | null> {
  let handle
  try {
    // O_NOFOLLOW refuses a link swapped in for the last name; O_NONBLOCK keeps a swapped-in FIFO from
    // parking a libuv thread. The identity check after opening covers everything else.
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
    const size = stats.size
    const reset = offset > size
    let start = reset ? 0 : offset
    let skippedBytes = 0
    // A first read of a long file, or a reader far behind a fast writer, starts near the end.
    const backlog = size - start
    if (
      (start === 0 && backlog > COMMAND_OUTPUT_FIRST_READ_TAIL_BYTES) ||
      backlog > COMMAND_OUTPUT_LAG_SKIP_BYTES
    ) {
      skippedBytes = backlog - COMMAND_OUTPUT_FIRST_READ_TAIL_BYTES
      start = size - COMMAND_OUTPUT_FIRST_READ_TAIL_BYTES
    }
    const length = Math.min(COMMAND_OUTPUT_CHUNK_BYTES, size - start)
    const buffer = Buffer.alloc(Math.max(0, length))
    const { bytesRead } =
      length > 0 ? await handle.read(buffer, 0, length, start) : { bytesRead: 0 }
    let bytes = buffer.subarray(0, bytesRead)
    if (skippedBytes > 0) {
      const lead = leadingContinuationBytes(bytes)
      bytes = bytes.subarray(lead)
      skippedBytes += lead
      start += lead
    }
    const held = incompleteUtf8Tail(bytes)
    const complete = bytes.subarray(0, bytes.length - held)
    const next = start + complete.length
    return {
      text: complete.toString('utf8'),
      offset: next,
      // Held-back bytes at the end of the file wait for their writer, not for another read.
      more: start + bytes.length < size,
      ...(skippedBytes > 0 ? { skippedBytes } : {}),
      ...(reset ? { reset: true as const } : {})
    }
  } catch {
    return null
  } finally {
    await handle.close().catch(() => {})
  }
}
