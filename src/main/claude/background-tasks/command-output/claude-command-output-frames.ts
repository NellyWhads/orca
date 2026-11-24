// Reads the harness's own words out of Claude stream frames; a command's stdout is never trusted for a path.

import { record } from '../claude-background-task-frames'
import { isClaudeCommandOutputId, isClaudeTaskOutputPathShape } from './claude-command-output-paths'

const LAUNCH_PATH_MARKER = 'Output is being written to: '

export function toolResultTexts(message: Record<string, unknown>): string[] {
  const content = record(message.message)?.content
  if (!Array.isArray(content)) {
    return []
  }
  const texts: string[] = []
  for (const entry of content) {
    const block = record(entry)
    if (block?.type !== 'tool_result') {
      continue
    }
    if (typeof block.content === 'string') {
      texts.push(block.content)
    } else if (Array.isArray(block.content)) {
      for (const part of block.content) {
        const text = record(part)?.text
        if (typeof text === 'string') {
          texts.push(text)
        }
      }
    }
  }
  return texts
}

export function toolResultIds(message: Record<string, unknown>): string[] {
  const content = record(message.message)?.content
  if (!Array.isArray(content)) {
    return []
  }
  return content.flatMap((entry) => {
    const id = record(entry)?.type === 'tool_result' ? record(entry)?.tool_use_id : undefined
    return isClaudeCommandOutputId(id) ? [id] : []
  })
}

/** The harness's launch message names the file; only trusted when the structured field named this task. */
export function launchMessagePath(texts: readonly string[], taskId: string): string | undefined {
  for (const text of texts) {
    const start = text.indexOf(LAUNCH_PATH_MARKER)
    if (start === -1) {
      continue
    }
    const from = start + LAUNCH_PATH_MARKER.length
    const name = `${taskId}.output`
    const end = text.indexOf(name, from)
    if (end === -1) {
      continue
    }
    const path = text.slice(from, end + name.length)
    if (!path.includes('\n') && isClaudeTaskOutputPathShape(path, taskId)) {
      return path
    }
  }
  return undefined
}
