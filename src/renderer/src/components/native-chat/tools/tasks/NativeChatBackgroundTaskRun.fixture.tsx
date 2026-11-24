import { defineFixture } from '../../../../component-fixtures/component-fixture'
import type { AgentSessionBackgroundTask } from '../../../../../../shared/agent-session/background-tasks/agent-session-background-task-wire'
import type { NativeChatBackgroundTaskBlock } from '../../../../../../shared/native-chat/native-chat-types'
import { nativeChatAppearanceStyle } from '../../appearance/native-chat-appearance-style'
import { NativeChatCommandOutputProvider } from '../../commands/native-chat-command-output-context'
import { NativeChatBackgroundTaskRun } from './NativeChatBackgroundTaskRun'

const now = Date.now()
const build: NativeChatBackgroundTaskBlock = {
  type: 'background-task',
  taskId: 'bgb0wl2zf',
  kind: 'command',
  label: 'Watch the web build',
  state: 'working',
  startedAt: now - 95_000
}
const server: NativeChatBackgroundTaskBlock = {
  ...build,
  taskId: 'b6mx8rx10',
  label: 'Run the dev server',
  startedAt: now - 30_000
}
const readable: AgentSessionBackgroundTask[] = [
  { id: build.taskId, kind: 'command', description: build.label, outputReadable: true }
]

/** The build's host streams its output, so its row carries the open icon; the server's row stays text. */
export const readableAndPlainRows = defineFixture({
  width: 560,
  render: () => (
    <div
      className="native-chat-appearance bg-chat-canvas p-3"
      style={nativeChatAppearanceStyle({})}
    >
      <NativeChatCommandOutputProvider
        target={{ kind: 'local' }}
        sessionId="fixture-session"
        paneKey="fixture:pane"
        tasks={readable}
        settledTasks={[]}
      >
        <NativeChatBackgroundTaskRun block={build} />
        <NativeChatBackgroundTaskRun block={server} />
      </NativeChatCommandOutputProvider>
    </div>
  )
})
