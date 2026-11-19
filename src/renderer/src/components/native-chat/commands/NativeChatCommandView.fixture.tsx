import { useEffect, useRef } from 'react'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { nativeChatAppearanceStyle } from '../appearance/native-chat-appearance-style'
import { NativeChatCommandOutputFrame } from './NativeChatCommandView'
import { useNativeChatCommandTerminal } from './use-native-chat-command-terminal'
import type { NativeChatCommandOutputStatus } from './use-native-chat-command-output-stream'

const BUILD_OUTPUT = [
  '\x1b[1m> orca@1.4.0 build\x1b[0m',
  '\x1b[36mvite\x1b[0m v7.1.0 building for production...',
  '\x1b[32m✓\x1b[0m 1742 modules transformed.',
  'dist/index.html                  \x1b[2m0.46 kB\x1b[0m',
  'dist/assets/index-4f2a.css     \x1b[2m81.20 kB\x1b[0m',
  '\x1b[33mwarning\x1b[0m: chunk index-9c1d.js is larger than 500 kB',
  'Downloading model  42% [=========>             ]\r' +
    'Downloading model  87% [====================>  ]',
  ''
].join('\n')

function Frame({
  status,
  text,
  skippedBytes = 0
}: {
  status: NativeChatCommandOutputStatus
  text: string
  skippedBytes?: number
}) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const sink = useNativeChatCommandTerminal(terminalRef, { scrollback: 500 })
  useEffect(() => {
    if (sink && text) {
      sink.write(text)
    }
  }, [sink, text])
  return (
    <div
      className="native-chat-appearance flex h-80 flex-col bg-chat-canvas"
      style={nativeChatAppearanceStyle({})}
    >
      <NativeChatCommandOutputFrame
        label="Build the app for production"
        status={status}
        skippedBytes={skippedBytes}
        hasOutput={text.length > 0}
        terminalRef={terminalRef}
      />
    </div>
  )
}

export const live = defineFixture({
  width: 640,
  render: () => <Frame status="live" text={BUILD_OUTPUT} />
})

export const liveSkippedOlderOutput = defineFixture({
  width: 640,
  render: () => <Frame status="live" text={BUILD_OUTPUT} skippedBytes={4_200_000} />
})

export const endedWithOutput = defineFixture({
  width: 640,
  render: () => <Frame status="ended" text={`${BUILD_OUTPUT}\n[exited with code 0]\n`} />
})

export const endedEmpty = defineFixture({
  width: 640,
  render: () => <Frame status="ended" text="" />
})

export const waiting = defineFixture({
  width: 640,
  render: () => <Frame status="waiting" text="" />
})

export const unavailable = defineFixture({
  width: 360,
  render: () => <Frame status="unavailable" text="" />
})
