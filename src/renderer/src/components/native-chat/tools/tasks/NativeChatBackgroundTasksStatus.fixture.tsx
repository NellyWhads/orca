import { defineFixture } from '../../../../component-fixtures/component-fixture'
import type { AgentSessionBackgroundTask } from '../../../../../../shared/agent-session/background-tasks/agent-session-background-task-wire'
import { nativeChatAppearanceStyle } from '../../appearance/native-chat-appearance-style'
import { NativeChatBackgroundTasksStatus } from './NativeChatBackgroundTasksStatus'

const now = Date.now()
const readableBuild: AgentSessionBackgroundTask = {
  id: 'bgb0wl2zf',
  kind: 'command',
  description: 'Watch the web build',
  state: 'working',
  startedAt: now - 95_000,
  outputReadable: true
}
const plainServer: AgentSessionBackgroundTask = {
  id: 'b6mx8rx10',
  kind: 'command',
  description: 'Run the dev server',
  state: 'working',
  startedAt: now - 30_000
}

function Strip({ currentCommandId = null }: { currentCommandId?: string | null }) {
  return (
    <div
      className="native-chat-appearance bg-chat-canvas p-3"
      style={nativeChatAppearanceStyle({})}
    >
      <NativeChatBackgroundTasksStatus
        tasks={[readableBuild, plainServer]}
        settledTasks={[]}
        supportsTaskStop
        offersStopAll
        stoppingTaskIds={new Set()}
        stoppingAll={false}
        indicatorActive
        isVisible
        expanded
        onExpandedChange={() => {}}
        onStop={() => {}}
        readableCommands={new Map([[readableBuild.id, readableBuild]])}
        onShowCommand={() => {}}
        currentCommandId={currentCommandId}
      />
    </div>
  )
}

/** The build's host streams its output, so its row opens; the server's does not, so it stays text. */
export const readableAndPlainCommands = defineFixture({
  width: 560,
  render: () => <Strip />
})

export const readableCommandOpen = defineFixture({
  width: 560,
  render: () => <Strip currentCommandId={readableBuild.id} />
})

export const readableCommandHovered = defineFixture({
  width: 560,
  render: () => <Strip />,
  interact: async (frame) => {
    frame.querySelector<HTMLElement>('[data-native-chat-agent-row="bgb0wl2zf"]')?.focus()
  }
})
