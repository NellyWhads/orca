// Renders the real tool row, tail, stream and slot cap; only the host's read is stubbed.

import { defineFixture } from '../../../component-fixtures/component-fixture'
import type {
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../../../shared/native-chat/native-chat-types'
import type { AgentSessionReadCommandOutputResult } from '../../../../../shared/rpc-contract/native-chat/agent-session-command-output-params'
import { nativeChatAppearanceStyle } from '../appearance/native-chat-appearance-style'
import { NativeChatToolLine } from '../tools/lines/NativeChatToolLine'
import { NativeChatCommandOutputProvider } from './native-chat-command-output-context'

const TEST_OUTPUT = [
  '\x1b[1m RUN \x1b[0m v5.0.5 /work/orca',
  '\x1b[32m ✓\x1b[0m src/shared/text/own-retained-string.test.ts \x1b[2m(4 tests)\x1b[0m',
  '\x1b[32m ✓\x1b[0m src/main/claude/background-tasks/frames.test.ts \x1b[2m(12 tests)\x1b[0m',
  '\x1b[31m ✗\x1b[0m src/main/native-chat/transcript-reader.test.ts \x1b[2m(1 failed)\x1b[0m',
  '\x1b[33m ⠙\x1b[0m src/renderer/src/components/native-chat/NativeChatView.test.tsx',
  ''
].join('\n')

function call(callId: string, command: string): NativeChatToolCallBlock {
  return {
    type: 'tool-call',
    name: 'Bash',
    input: { command, description: 'Run the unit tests' },
    callId,
    state: 'running'
  }
}

/** Answer reads the way a host does: the output once, then nothing new while the command runs. */
function stubCommandOutput(): void {
  const runtime = window.api.runtime
  const fallback = runtime.call
  Reflect.set(window.api, 'runtime', {
    ...runtime,
    call: async (request: Parameters<typeof fallback>[0]) => {
      if (request.method !== 'agentSession.readCommandOutput') {
        return fallback(request)
      }
      const params: unknown = request.params
      const offset =
        typeof params === 'object' && params !== null && 'offset' in params
          ? Number(params.offset)
          : 0
      const result: AgentSessionReadCommandOutputResult = {
        status: 'output',
        text: offset === 0 ? TEST_OUTPUT : '',
        offset: offset === 0 ? new TextEncoder().encode(TEST_OUTPUT).length : offset,
        ended: false,
        more: false
      }
      return { id: 'fixture', ok: true, result, _meta: { runtimeId: 'fixture' } }
    }
  })
}

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="native-chat-appearance bg-chat-canvas p-3"
      style={nativeChatAppearanceStyle({})}
    >
      <NativeChatCommandOutputProvider
        target={{ kind: 'local' }}
        sessionId="fixture-session"
        paneKey="fixture:pane"
        tasks={[]}
        settledTasks={[]}
      >
        {children}
      </NativeChatCommandOutputProvider>
    </div>
  )
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A running foreground command streams under its row. */
export const runningWithLiveTail = defineFixture({
  width: 640,
  setup: stubCommandOutput,
  render: () => (
    <Pane>
      <NativeChatToolLine block={call('toolu_live1', 'pnpm test --maxWorkers=2')} />
    </Pane>
  ),
  interact: () => wait(800)
})

/** Four commands run at once: three stream, the fourth offers to open its output instead. */
export const overCapOffersOpen = defineFixture({
  width: 640,
  setup: stubCommandOutput,
  render: () => (
    <Pane>
      <NativeChatToolLine block={call('toolu_cap1', 'pnpm test src/main')} />
      <NativeChatToolLine block={call('toolu_cap2', 'pnpm test src/shared')} />
      <NativeChatToolLine block={call('toolu_cap3', 'pnpm test src/renderer')} />
      <NativeChatToolLine block={call('toolu_cap4', 'pnpm tc')} />
    </Pane>
  ),
  interact: () => wait(5600)
})

const finished: NativeChatToolResultBlock = {
  type: 'tool-result',
  callId: 'toolu_done1',
  output: 'RUN v5.0.5 /work/orca\n✓ 3 passed, 1 failed\nTest Files 4 (4)'
}

/** Once the result arrives the tail is gone; the row reads as any finished command, output behind it. */
export const handedOverToResult = defineFixture({
  width: 640,
  setup: stubCommandOutput,
  render: () => (
    <Pane>
      <NativeChatToolLine
        block={{ ...call('toolu_done1', 'pnpm test --maxWorkers=2'), state: 'completed' }}
        result={finished}
      />
    </Pane>
  ),
  interact: async (frame) => {
    frame.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click()
    await wait(400)
  }
})
