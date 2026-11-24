// Shell-task turns for the Claude stub, framed as Claude Code 2.1.326 frames them: a prompt containing
// `shell-task:background`, `shell-task:foreground` or `shell-task:foreground-many` runs Bash calls whose output
// streams into <CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid>/<cwd bucket>/<session>/tasks/<task id>.output.
const { randomBytes, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const TICK_MS = 250
const ESCAPE = String.fromCharCode(27)

/** The plain text a tool result carries, as Claude Code returns it without terminal styling. */
function stripAnsi(text) {
  return text.replaceAll(new RegExp(`${ESCAPE}\\[[0-9;]*[A-Za-z]`, 'g'), '')
}

function taskId() {
  return `b${randomBytes(6).toString('hex').slice(0, 8)}`
}

function tasksDir(sessionId) {
  const root = path.join(process.env.CLAUDE_CODE_TMPDIR || '/tmp', `claude-${process.getuid()}`)
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const bucket = fs.realpathSync(process.cwd()).replace(/[^a-zA-Z0-9]/g, '-')
  const dir = path.join(root, bucket, sessionId, 'tasks')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Lines a build prints: coloured ticks, with an in-place progress bar between them. */
function outputSteps(label, lines) {
  const steps = []
  for (let line = 1; line <= lines; line++) {
    for (const percent of [25, 50, 75, 100]) {
      const filled = '='.repeat(percent / 5).padEnd(20, ' ')
      steps.push(`\r\x1b[33m${label} ${line}/${lines} [${filled}] ${percent}%\x1b[0m`)
    }
    steps.push(`\r\x1b[2K\x1b[32m✓ ${label} step ${line}\x1b[0m\n`)
  }
  return steps
}

function assistantToolUses(sessionId, calls) {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      id: randomUUID(),
      role: 'assistant',
      model: 'claude-fake',
      content: calls.map((call) => ({
        type: 'tool_use',
        id: call.toolUseId,
        name: 'Bash',
        input: {
          command: call.command,
          description: call.description,
          ...(call.background ? { run_in_background: true } : { timeout: 120000 })
        }
      }))
    }
  }
}

function toolResult(sessionId, toolUseId, text, extra = {}) {
  return {
    type: 'user',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }]
    },
    tool_use_result: {
      stdout: text,
      stderr: '',
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
      ...extra
    }
  }
}

function startTask(sessionId, call, write) {
  write({
    type: 'system',
    subtype: 'task_started',
    session_id: sessionId,
    uuid: randomUUID(),
    task_id: call.taskId,
    tool_use_id: call.toolUseId,
    description: call.description,
    is_backgrounded: call.background,
    task_type: 'local_bash'
  })
}

/** Streams the steps into the task's file; resolves with the plain text the command printed. */
function streamOutput(file, steps) {
  fs.writeFileSync(file, '')
  return new Promise((resolve) => {
    let index = 0
    const timer = setInterval(() => {
      if (index >= steps.length) {
        clearInterval(timer)
        resolve(fs.readFileSync(file, 'utf8'))
        return
      }
      fs.appendFileSync(file, steps[index++])
    }, TICK_MS)
  })
}

function endTurn(sessionId, write, text) {
  write({
    type: 'assistant',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      id: randomUUID(),
      role: 'assistant',
      model: 'claude-fake',
      content: [{ type: 'text', text }]
    }
  })
  write({
    type: 'result',
    subtype: 'success',
    uuid: randomUUID(),
    session_id: sessionId,
    is_error: false,
    terminal_reason: 'completed',
    result: text
  })
}

function runBackground(sessionId, write) {
  const dir = tasksDir(sessionId)
  const call = {
    taskId: taskId(),
    toolUseId: `toolu_${randomBytes(8).toString('hex')}`,
    command: 'pnpm build --watch',
    description: 'Build the web bundle in the background',
    background: true
  }
  const file = path.join(dir, `${call.taskId}.output`)
  write(assistantToolUses(sessionId, [call]))
  write({
    type: 'system',
    subtype: 'background_tasks_changed',
    session_id: sessionId,
    uuid: randomUUID(),
    tasks: [{ task_id: call.taskId, task_type: 'local_bash', description: call.description }]
  })
  startTask(sessionId, call, write)
  const done = streamOutput(file, outputSteps('bundle', 30))
  write(
    toolResult(
      sessionId,
      call.toolUseId,
      `Command running in background with ID: ${call.taskId}. Output is being written to: ${file}. You will be notified when it completes. To check interim output, use Read on that file path.`,
      { stdout: '', backgroundTaskId: call.taskId }
    )
  )
  endTurn(sessionId, write, 'Started the build in the background.')
  void done.then(() => {
    fs.appendFileSync(file, '\n[exited with code 0]\n')
    write({
      type: 'system',
      subtype: 'task_updated',
      session_id: sessionId,
      uuid: randomUUID(),
      task_id: call.taskId,
      patch: { status: 'completed', end_time: Date.now() }
    })
    write({
      type: 'system',
      subtype: 'task_notification',
      session_id: sessionId,
      uuid: randomUUID(),
      task_id: call.taskId,
      tool_use_id: call.toolUseId,
      status: 'completed',
      output_file: file,
      summary: `Background command "${call.description}" completed (exit code 0)`
    })
    write({
      type: 'system',
      subtype: 'background_tasks_changed',
      session_id: sessionId,
      uuid: randomUUID(),
      tasks: []
    })
  })
}

// Claude Code announces a foreground command's task a few seconds after it starts.
const ANNOUNCE_MS = 1500

function runForeground(sessionId, write, count, lines) {
  const dir = tasksDir(sessionId)
  const calls = Array.from({ length: count }, (_, index) => ({
    taskId: taskId(),
    toolUseId: `toolu_${randomBytes(8).toString('hex')}`,
    command: `pnpm test --shard=${index + 1}/${count}`,
    description: `Run test shard ${index + 1}`,
    background: false
  }))
  write(assistantToolUses(sessionId, calls))
  const runs = calls.map(
    (call, index) =>
      new Promise((resolve) => {
        setTimeout(() => {
          startTask(sessionId, call, write)
          const file = path.join(dir, `${call.taskId}.output`)
          void streamOutput(file, outputSteps(`shard ${index + 1}`, lines)).then((printed) => {
            fs.rmSync(file, { force: true })
            write({
              type: 'system',
              subtype: 'task_notification',
              session_id: sessionId,
              uuid: randomUUID(),
              task_id: call.taskId,
              tool_use_id: call.toolUseId,
              status: 'completed',
              output_file: '',
              summary: call.description
            })
            write(toolResult(sessionId, call.toolUseId, stripAnsi(printed)))
            resolve()
          })
        }, ANNOUNCE_MS)
      })
  )
  void Promise.all(runs).then(() => endTurn(sessionId, write, 'All commands finished.'))
}

/** Runs a shell-task turn when the prompt asks for one; false leaves the turn to the stub. */
function runShellTaskTurn(prompt, sessionId, write) {
  if (prompt.includes('shell-task:background')) {
    runBackground(sessionId, write)
    return true
  }
  if (prompt.includes('shell-task:foreground-many')) {
    runForeground(sessionId, write, 5, 12)
    return true
  }
  if (prompt.includes('shell-task:foreground')) {
    runForeground(sessionId, write, 1, 16)
    return true
  }
  return false
}

module.exports = { runShellTaskTurn }
