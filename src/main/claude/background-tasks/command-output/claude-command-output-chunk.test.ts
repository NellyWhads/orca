import { describe, expect, it } from 'vitest'
import { commandOutputReadWindow, decodeCommandOutputBytes } from './claude-command-output-chunk'

const MIB = 1024 * 1024

describe('commandOutputReadWindow', () => {
  it('reads from the offset while the reader keeps up', () => {
    expect(commandOutputReadWindow(1000, 400)).toEqual({
      start: 400,
      length: 600,
      skippedBytes: 0,
      reset: false
    })
  })

  it('starts a first read of a long file one MiB from its end', () => {
    expect(commandOutputReadWindow(5 * MIB, 0)).toEqual({
      start: 4 * MIB,
      length: 65536,
      skippedBytes: 4 * MIB,
      reset: false
    })
  })

  it('jumps a reader far behind a fast writer to the last chunk', () => {
    expect(commandOutputReadWindow(10 * MIB, 1000)).toEqual({
      start: 10 * MIB - 65536,
      length: 65536,
      skippedBytes: 10 * MIB - 65536 - 1000,
      reset: false
    })
  })

  it('restarts from the top when the file shrank below the offset', () => {
    expect(commandOutputReadWindow(10, 50)).toEqual({
      start: 0,
      length: 10,
      skippedBytes: 0,
      reset: true
    })
  })
})

describe('decodeCommandOutputBytes', () => {
  it('holds back a character split across reads and resumes at its first byte', () => {
    // "ok ✓" is 6f 6b 20 e2 9c 93; the writer has so far written two bytes of the check mark.
    const bytes = Uint8Array.from([0x6f, 0x6b, 0x20, 0xe2, 0x9c])
    const window = { start: 100, length: 5, skippedBytes: 0, reset: false }
    expect(decodeCommandOutputBytes(bytes, window, 105)).toEqual({
      text: 'ok ',
      offset: 103,
      more: false
    })
  })

  it('drops the tail of a character a skip cut through and counts it as skipped', () => {
    // A skip landed on the last two bytes of "✓" (e2 9c 93), then "done".
    const bytes = Uint8Array.from([0x9c, 0x93, 0x64, 0x6f, 0x6e, 0x65])
    const window = { start: 4000, length: 6, skippedBytes: 3990, reset: false }
    expect(decodeCommandOutputBytes(bytes, window, 4010)).toEqual({
      text: 'done',
      offset: 4006,
      more: true,
      skippedBytes: 3992
    })
  })
})
