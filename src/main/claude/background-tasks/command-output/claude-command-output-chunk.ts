import { open } from 'node:fs/promises'
import { constants } from 'node:fs'

/** One read's ceiling, so a fast writer cannot make a single reply large. */
export const COMMAND_OUTPUT_CHUNK_BYTES = 64 * 1024
/** A first read of a long file starts this far from its end; older output stays on disk. */
export const COMMAND_OUTPUT_FIRST_READ_TAIL_BYTES = 1024 * 1024

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

/** Null when the file is missing or unreadable; the caller decides what that means. */
export async function readClaudeCommandOutputChunk(
  path: string,
  offset: number
): Promise<ClaudeCommandOutputChunk | null> {
  let handle
  try {
    // O_NOFOLLOW: the path was verified as a regular file; refuse it if it became a link since.
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch {
    return null
  }
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) {
      return null
    }
    const size = stats.size
    const reset = offset > size
    let start = reset ? 0 : offset
    let skippedBytes = 0
    if (start === 0 && size > COMMAND_OUTPUT_FIRST_READ_TAIL_BYTES) {
      start = size - COMMAND_OUTPUT_FIRST_READ_TAIL_BYTES
      skippedBytes = start
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
