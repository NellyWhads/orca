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

/**
 * Opens xterm in the container and returns a sink that writes into it, or null until it opens (or when it can't).
 * `rows` fixes the height (the inline tail); without it the terminal fills its container.
 */
export function useNativeChatCommandTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: { rows?: number; scrollback: number }
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
  const { rows, scrollback } = options

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
          rows: rows ?? 24,
          scrollback
        }),
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
        terminal.resize(proposed.cols, rows ?? Math.max(2, proposed.rows))
      }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    standalone.write(HIDE_CURSOR, { live: true })
    setSink({
      write: (text) => standalone.write(text, { live: true }),
      reset: () => {
        terminal.reset()
        standalone.write(HIDE_CURSOR, { live: true })
      }
    })
    return () => {
      observer.disconnect()
      terminalRef.current = null
      setSink(null)
      standalone.dispose()
    }
  }, [containerRef, rows, scrollback])

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
