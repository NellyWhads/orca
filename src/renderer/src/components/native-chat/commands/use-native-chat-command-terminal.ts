// A read-only xterm for command output: colours and carriage-return progress bars render as in a terminal.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import type { ITheme } from '@xterm/xterm'
import { composeActiveTerminalTheme } from '@/components/terminal-pane/appearance/terminal-appearance'
import { useSystemPrefersDark } from '@/hooks/theme/use-system-prefers-dark'
import { resolveEffectiveTerminalAppearance } from '@/lib/terminal/appearance/terminal-theme'
import { useAppStore } from '@/store/index'
import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import { TerminalKittyKeyboardModeTracker } from '../../../../../shared/terminal/protocol/input-modes/terminal-kitty-keyboard-mode-tracker'
import { openStandaloneTerminal } from '../../standalone-terminal/open-standalone-terminal'
import { buildPreviewTerminalOptions } from '../../standalone-terminal/rendering/preview-terminal-options'
import type { NativeChatCommandOutputSink } from './use-native-chat-command-output-stream'

// A command's own cursor means nothing in a read-only copy of its output.
const HIDE_CURSOR = '\x1b[?25l'

/** The size and face `text-chat-code font-mono` resolves to on the container, which follows Code text size. */
function chatCodeFont(container: HTMLElement): { fontSize?: number; fontFamily?: string } {
  const style = getComputedStyle(container)
  const fontSize = Number.parseFloat(style.fontSize)
  return {
    ...(Number.isFinite(fontSize) && fontSize > 0 ? { fontSize } : {}),
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {})
  }
}

function terminalColors(
  settings: GlobalSettings | null,
  systemPrefersDark: boolean
): { theme: ITheme | null; mode: 'dark' | 'light' } {
  if (!settings) {
    return { theme: null, mode: 'dark' }
  }
  const appearance = resolveEffectiveTerminalAppearance(settings, systemPrefersDark)
  return { theme: composeActiveTerminalTheme(appearance.theme, settings), mode: appearance.mode }
}

/** Opens xterm filling the container and returns a sink into it; null until it opens, or when it can't. */
export function useNativeChatCommandTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: {
    scrollback: number
    /** Tool output in the transcript uses the chat's code type (native-chat.md), not the terminal font. */
    codeFont?: boolean
    /** Called for a plain Esc inside the terminal, before xterm swallows it. */
    onEscape?: () => void
  }
): NativeChatCommandOutputSink | null {
  const settings = useAppStore((state) => state.settings)
  const systemPrefersDark = useSystemPrefersDark()
  const settingsRef = useRef(settings)
  const darkRef = useRef(systemPrefersDark)
  useLayoutEffect(() => {
    settingsRef.current = settings
    darkRef.current = systemPrefersDark
  }, [settings, systemPrefersDark])
  const [sink, setSink] = useState<NativeChatCommandOutputSink | null>(null)
  const terminalRef = useRef<{
    standalone: NonNullable<ReturnType<typeof openStandaloneTerminal>>
    container: HTMLDivElement
  } | null>(null)
  const { scrollback, codeFont = false } = options
  const onEscapeRef = useRef(options.onEscape)
  useLayoutEffect(() => {
    onEscapeRef.current = options.onEscape
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const { theme, mode } = terminalColors(settingsRef.current, darkRef.current)
    const standalone = openStandaloneTerminal({
      container,
      options: {
        ...buildPreviewTerminalOptions({
          settings: settingsRef.current,
          terminalInput: null,
          macOptionIsMeta: false,
          theme,
          themeMode: mode,
          cols: 80,
          rows: 24,
          scrollback
        }),
        ...(codeFont ? chatCodeFont(container) : {}),
        // The output files hold bare LF line ends; nobody types into this terminal.
        convertEol: true,
        disableStdin: true,
        cursorBlink: false
      },
      kittyKeyboardModes: new TerminalKittyKeyboardModeTracker({ kittyKeyboard: false }),
      sessionKey: 'native-chat-command-output',
      sendInput: () => false,
      answersQueries: false,
      getSettings: () => settingsRef.current,
      getMacOptionAsAlt: () => 'false',
      getTerminalInput: () => null
    })
    if (!standalone) {
      return
    }
    // The padding around the grid reads as part of the terminal, not a second surface.
    container.style.backgroundColor = theme?.background ?? ''
    terminalRef.current = { standalone, container }
    const { terminal } = standalone
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    const resize = () => {
      const proposed = fit.proposeDimensions()
      if (proposed && proposed.cols > 1) {
        terminal.resize(proposed.cols, Math.max(2, proposed.rows))
      }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    // Capture runs before xterm's own handler on its textarea, which cancels the key.
    const onKeyDown = (event: KeyboardEvent) => {
      const onEscape = onEscapeRef.current
      if (
        onEscape &&
        event.key === 'Escape' &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault()
        event.stopPropagation()
        onEscape()
      }
    }
    container.addEventListener('keydown', onKeyDown, true)
    standalone.write(HIDE_CURSOR, { live: true })
    setSink({
      write: (text) => standalone.write(text, { live: true }),
      reset: () => {
        terminal.reset()
        standalone.write(HIDE_CURSOR, { live: true })
      }
    })
    return () => {
      container.removeEventListener('keydown', onKeyDown, true)
      observer.disconnect()
      terminalRef.current = null
      setSink(null)
      standalone.dispose()
    }
  }, [codeFont, containerRef, scrollback])

  // Follow theme changes without reopening the terminal or losing what it shows.
  useEffect(() => {
    const open = terminalRef.current
    if (open) {
      const { theme } = terminalColors(settings, systemPrefersDark)
      open.standalone.terminal.options.theme = theme ?? undefined
      open.container.style.backgroundColor = theme?.background ?? ''
    }
  }, [settings, systemPrefersDark])

  return sink
}
