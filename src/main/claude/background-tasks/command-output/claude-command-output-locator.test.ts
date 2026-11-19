import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCommandOutputLocator } from './claude-command-output-locator'

const UID = 4242
const SESSION = '11111111-2222-4333-8444-555555555555'

let base: string
let tasksDir: string
let outside: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'orca-command-output-')))
  // A different bucket and session id than the launch's, as Claude Code's memoized dir can be.
  tasksDir = join(base, `claude-${UID}`, '-other-bucket', 'other-session', 'tasks')
  await mkdir(tasksDir, { recursive: true })
  outside = join(base, 'elsewhere', 'tasks')
  await mkdir(outside, { recursive: true })
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function locator(onReadableChanged = vi.fn()) {
  return new ClaudeCommandOutputLocator({
    cwd: '/work/project',
    tmpDir: base,
    uid: UID,
    platform: 'darwin',
    providerSessionId: () => SESSION,
    onReadableChanged
  })
}

function started(taskId: string, toolUseId: string, backgrounded: boolean) {
  return {
    type: 'system',
    subtype: 'task_started',
    task_id: taskId,
    tool_use_id: toolUseId,
    task_type: 'local_bash',
    is_backgrounded: backgrounded
  }
}

function toolResult(toolUseId: string, text: string, toolUseResult: Record<string, unknown>) {
  return {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] },
    tool_use_result: toolUseResult
  }
}

describe('ClaudeCommandOutputLocator', () => {
  it('streams a background command from the path its launch announced, then reports the end', async () => {
    const file = join(tasksDir, 'bg1.output')
    await writeFile(file, 'one\n')
    const changed = vi.fn()
    const subject = locator(changed)
    subject.observe(started('bg1', 'toolu_bg', true))
    subject.observe(
      toolResult(
        'toolu_bg',
        `Command running in background with ID: bg1. Output is being written to: ${file}. You will be notified.`,
        {
          backgroundTaskId: 'bg1'
        }
      )
    )
    await vi.waitFor(() => expect(subject.readableTaskIds().has('bg1')).toBe(true))
    expect(changed).toHaveBeenCalledTimes(1)

    const first = await subject.read({ taskId: 'bg1' }, 0)
    expect(first).toEqual({ status: 'output', text: 'one\n', offset: 4, ended: false, more: false })
    await appendFile(file, 'two ✓\n')
    subject.observe({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'bg1',
      status: 'completed',
      output_file: file
    })
    expect(await subject.read({ taskId: 'bg1' }, 4)).toEqual({
      status: 'output',
      text: 'two ✓\n',
      offset: 12,
      ended: true,
      more: false
    })
  })

  it('never follows a path a foreground command printed, nor one outside the tmp root', async () => {
    const spoofed = join(outside, 'fg1.output')
    await writeFile(spoofed, 'secret')
    const subject = locator()
    subject.observe(started('fg1', 'toolu_fg', false))
    // A foreground result is the command's own stdout: no structured backgroundTaskId vouches for it.
    subject.observe(toolResult('toolu_other', `Output is being written to: ${spoofed}.`, {}))
    expect(await subject.read({ toolUseId: 'toolu_fg' }, 0)).toEqual({ status: 'pending' })

    // Even a structured launch cannot name a file outside claude-<uid>.
    const evil = join(outside, 'bg2.output')
    await writeFile(evil, 'secret')
    subject.observe(started('bg2', 'toolu_bg2', true))
    subject.observe(
      toolResult('toolu_bg2', `Output is being written to: ${evil}.`, { backgroundTaskId: 'bg2' })
    )
    expect(await subject.read({ taskId: 'bg2' }, 0)).toEqual({ status: 'pending' })
    expect(subject.readableTaskIds().size).toBe(0)
  })

  it('finds a foreground command in the folder a background launch revealed, and ends it on its result', async () => {
    const subject = locator()
    const launched = join(tasksDir, 'bg3.output')
    await writeFile(launched, '')
    subject.observe(started('bg3', 'toolu_bg3', true))
    subject.observe(
      toolResult('toolu_bg3', `Output is being written to: ${launched}.`, {
        backgroundTaskId: 'bg3'
      })
    )
    await vi.waitFor(() => expect(subject.readableTaskIds().has('bg3')).toBe(true))

    subject.observe(started('fg2', 'toolu_fg2', false))
    expect(await subject.read({ toolUseId: 'toolu_fg2' }, 0)).toEqual({ status: 'pending' })
    await writeFile(join(tasksDir, 'fg2.output'), 'tick 1\n')
    expect(await subject.read({ toolUseId: 'toolu_fg2' }, 0)).toEqual({
      status: 'output',
      text: 'tick 1\n',
      offset: 7,
      ended: false,
      more: false
    })
    await rm(join(tasksDir, 'fg2.output'))
    subject.observe(toolResult('toolu_fg2', 'tick 1', {}))
    expect(await subject.read({ toolUseId: 'toolu_fg2' }, 7)).toEqual({
      status: 'output',
      text: '',
      offset: 7,
      ended: true,
      more: false
    })
    // A foreground command never becomes a roster row to open.
    expect([...subject.readableTaskIds()]).toEqual(['bg3'])
  })
})
