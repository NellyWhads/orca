// Finds and reads the files Claude Code streams shell output into, for one Claude session.
// Paths are learned only from harness-structured evidence (a background launch's `backgroundTaskId`, a
// notification's `output_file`, an Agent launch's `outputFile`), never from a command's own stdout, and every
// route must stay inside the per-user tmp root. Anything unproven reads as "no live output".

import { dirname, join } from 'node:path'
import type { AgentSessionReadCommandOutputResult } from '../../../../shared/rpc-contract/native-chat/agent-session-command-output-params'
import { classifyClaudeBackgroundTaskKind } from '../../../../shared/agent-hook-listener/providers/claude/background-tasks/claude-background-task-kind'
import { record, terminalClaudeTaskRunState } from '../claude-background-task-frames'
import {
  claudeCommandOutputRoot,
  computedClaudeTaskDirs,
  isClaudeCommandOutputId,
  isClaudeTaskDirShape,
  isClaudeTaskOutputPathShape,
  verifiedClaudeTaskDir,
  verifiedClaudeTaskOutputFile
} from './claude-command-output-paths'
import { readClaudeCommandOutputChunk } from './claude-command-output-chunk'
import { launchMessagePath, toolResultIds, toolResultTexts } from './claude-command-output-frames'

const MAX_TRACKED_COMMANDS = 256
const MAX_LEARNED_DIRS = 4

type TrackedCommand = {
  taskId: string
  toolUseId?: string
  backgrounded: boolean
  ended: boolean
  /** From structured evidence only; still verified before use. */
  exactPath?: string
  resolved?: string
}

export type ClaudeCommandOutputLocatorOptions = {
  cwd: string
  tmpDir?: string
  providerSessionId: () => string
  /** Called when the set of tasks with readable output changes, never on other observations. */
  onReadableChanged?: () => void
  platform?: NodeJS.Platform
  uid?: number
}

export type ClaudeCommandOutputTarget = { taskId: string } | { toolUseId: string }

export class ClaudeCommandOutputLocator {
  private readonly commands = new Map<string, TrackedCommand>()
  private readonly byToolUse = new Map<string, string>()
  private readonly learnedDirs: string[] = []
  private readonly readable = new Set<string>()
  private rootPromise: Promise<string | null> | null = null
  private generation = 0

  constructor(private readonly options: ClaudeCommandOutputLocatorOptions) {}

  /** Background tasks whose output file was found; the roster offers to open these. */
  readableTaskIds(): ReadonlySet<string> {
    return this.readable
  }

  observe(message: Record<string, unknown>): void {
    if (message.type === 'system') {
      this.observeSystem(message)
    } else if (message.type === 'user') {
      this.observeUser(message)
    }
  }

  clear(): void {
    this.generation++
    this.commands.clear()
    this.byToolUse.clear()
    this.learnedDirs.length = 0
    if (this.readable.size > 0) {
      this.readable.clear()
      this.options.onReadableChanged?.()
    }
  }

  async read(
    target: ClaudeCommandOutputTarget,
    offset: number
  ): Promise<AgentSessionReadCommandOutputResult> {
    const taskId = 'taskId' in target ? target.taskId : this.byToolUse.get(target.toolUseId)
    const command = taskId === undefined ? undefined : this.commands.get(taskId)
    if (!command) {
      // A foreground command announces its task a few seconds in; until then, keep asking.
      return 'toolUseId' in target ? { status: 'pending' } : { status: 'unavailable' }
    }
    const ended = { status: 'output', text: '', offset, ended: true, more: false } as const
    const path = command.resolved ?? (await this.resolve(command))
    if (!path) {
      return command.ended ? ended : { status: 'pending' }
    }
    const chunk = await readClaudeCommandOutputChunk(path, offset)
    if (!chunk) {
      // A foreground command's file is deleted as it ends; the end frame follows.
      return command.ended ? ended : { status: 'pending' }
    }
    return { status: 'output', ...chunk, ended: command.ended }
  }

  private observeSystem(message: Record<string, unknown>): void {
    const taskId = message.task_id
    if (!isClaudeCommandOutputId(taskId)) {
      return
    }
    if (message.subtype === 'task_started') {
      if (classifyClaudeBackgroundTaskKind(message.task_type) !== 'command') {
        return
      }
      const toolUseId = isClaudeCommandOutputId(message.tool_use_id)
        ? message.tool_use_id
        : undefined
      this.track({
        taskId,
        ...(toolUseId ? { toolUseId } : {}),
        backgrounded: message.is_backgrounded === true,
        ended: false
      })
      return
    }
    const command = this.commands.get(taskId)
    if (!command) {
      return
    }
    if (message.subtype === 'task_updated') {
      const patch = record(message.patch)
      if (patch?.is_backgrounded === true && !command.backgrounded) {
        command.backgrounded = true
        void this.resolve(command)
      }
      if (terminalClaudeTaskRunState(patch?.status)) {
        command.ended = true
      }
    } else if (message.subtype === 'task_notification') {
      command.ended = true
      const outputFile = message.output_file
      if (typeof outputFile === 'string' && isClaudeTaskOutputPathShape(outputFile, taskId)) {
        command.exactPath = outputFile
        void this.resolve(command)
      }
    }
  }

  private observeUser(message: Record<string, unknown>): void {
    const result = record(message.tool_use_result)
    const backgroundTaskId = result?.backgroundTaskId
    if (isClaudeCommandOutputId(backgroundTaskId)) {
      const command = this.commands.get(backgroundTaskId)
      const path = launchMessagePath(toolResultTexts(message), backgroundTaskId)
      if (command) {
        command.backgrounded = true
        if (path) {
          command.exactPath = path
        }
        void this.resolve(command)
      } else if (path) {
        this.learnDir(dirname(path))
      }
    } else {
      // A foreground command's result has arrived: its output now lives in the transcript.
      for (const toolUseId of toolResultIds(message)) {
        const taskId = this.byToolUse.get(toolUseId)
        const command = taskId === undefined ? undefined : this.commands.get(taskId)
        if (command && !command.backgrounded) {
          command.ended = true
        }
      }
    }
    const agentOutput = result?.outputFile
    if (typeof agentOutput === 'string' && isClaudeTaskDirShape(dirname(agentOutput))) {
      this.learnDir(dirname(agentOutput))
    }
  }

  private track(command: TrackedCommand): void {
    const prior = this.commands.get(command.taskId)
    this.commands.delete(command.taskId)
    this.commands.set(command.taskId, prior ? { ...prior, ...command } : command)
    if (command.toolUseId) {
      this.byToolUse.set(command.toolUseId, command.taskId)
    }
    while (this.commands.size > MAX_TRACKED_COMMANDS) {
      const oldest = this.commands.values().next().value
      if (!oldest) {
        break
      }
      this.forget(oldest)
    }
    if (command.backgrounded) {
      void this.resolve(this.commands.get(command.taskId)!)
    }
  }

  private forget(command: TrackedCommand): void {
    this.commands.delete(command.taskId)
    if (command.toolUseId && this.byToolUse.get(command.toolUseId) === command.taskId) {
      this.byToolUse.delete(command.toolUseId)
    }
    if (this.readable.delete(command.taskId)) {
      this.options.onReadableChanged?.()
    }
  }

  private root(): Promise<string | null> {
    this.rootPromise ??= claudeCommandOutputRoot({
      ...(this.options.tmpDir ? { tmpDir: this.options.tmpDir } : {}),
      ...(this.options.platform ? { platform: this.options.platform } : {}),
      ...(this.options.uid !== undefined ? { uid: this.options.uid } : {})
    })
    return this.rootPromise
  }

  private learnDir(dir: string): void {
    const generation = this.generation
    void this.root().then(async (root) => {
      const verified = root ? await verifiedClaudeTaskDir(root, dir) : null
      if (!verified || generation !== this.generation || this.learnedDirs.includes(verified)) {
        return
      }
      this.learnedDirs.unshift(verified)
      this.learnedDirs.length = Math.min(this.learnedDirs.length, MAX_LEARNED_DIRS)
    })
  }

  private async resolve(command: TrackedCommand): Promise<string | null> {
    const generation = this.generation
    const root = await this.root()
    if (!root) {
      return null
    }
    const candidates = [
      ...(command.exactPath ? [command.exactPath] : []),
      ...this.learnedDirs.map((dir) => join(dir, `${command.taskId}.output`))
    ]
    let path: string | null = null
    for (const candidate of candidates) {
      path = await verifiedClaudeTaskOutputFile(root, candidate, command.taskId)
      if (path) {
        break
      }
    }
    if (!path) {
      const dirs = await computedClaudeTaskDirs(
        root,
        this.options.cwd,
        this.options.providerSessionId()
      )
      for (const dir of dirs) {
        path = await verifiedClaudeTaskOutputFile(
          root,
          join(dir, `${command.taskId}.output`),
          command.taskId
        )
        if (path) {
          break
        }
      }
    }
    if (!path || generation !== this.generation || this.commands.get(command.taskId) !== command) {
      return path
    }
    command.resolved = path
    const dir = dirname(path)
    if (!this.learnedDirs.includes(dir)) {
      this.learnedDirs.unshift(dir)
      this.learnedDirs.length = Math.min(this.learnedDirs.length, MAX_LEARNED_DIRS)
    }
    if (command.backgrounded && !this.readable.has(command.taskId)) {
      this.readable.add(command.taskId)
      this.options.onReadableChanged?.()
    }
    return path
  }
}
