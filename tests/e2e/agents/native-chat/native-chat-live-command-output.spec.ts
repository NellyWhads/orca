// A Claude stub streams shell output the way Claude Code does; the chat shows it live, in the view and inline.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Locator, Page } from '@stablyai/playwright-test'
import '../../desktop/electron-fixtures/orca-app'
import { expect } from '@stablyai/playwright-test'
import {
  SUPPORTED,
  claudeStubPath,
  openStubChat,
  test as stubTest
} from '../session-fixtures/structured-claude-stub'

// Screenshots for a reader; unset keeps runs side-effect free.
const SHOT_DIR = process.env.ORCA_E2E_LIVE_OUTPUT_SHOTS

const test = stubTest.extend<{ shellTaskTmp: string }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright fixture callbacks require object destructuring here.
  shellTaskTmp: async ({}, provideFixture) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-shell-tasks-'))
    await provideFixture(dir)
    rmSync(dir, { recursive: true, force: true })
  },
  launchEnv: async ({ claudeStub, shellTaskTmp }, provideFixture) => {
    // The stub and Orca's reader agree on Claude Code's tmp root through this, as the real CLI does.
    await provideFixture({ PATH: claudeStubPath(claudeStub), CLAUDE_CODE_TMPDIR: shellTaskTmp })
  }
})

async function shot(page: Page, name: string): Promise<void> {
  if (SHOT_DIR) {
    mkdirSync(SHOT_DIR, { recursive: true })
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) })
  }
}

/** What a terminal shows, read from xterm's own buffer so it holds for any renderer. */
function terminalText(log: Locator): Promise<string> {
  return log.evaluate((element) => {
    const rows = element.querySelector('.xterm-rows')
    return rows?.textContent ?? ''
  })
}

async function send(page: Page, composer: Locator, sendButton: Locator, text: string) {
  await composer.click()
  await page.keyboard.type(text)
  await sendButton.click()
}

test.describe('live command output', () => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')
  // Each test streams real output for 10-25 s on top of a cold app start.
  test.setTimeout(180_000)

  test('a background command opens into a live, read-only view', async ({
    orcaPage: page,
    electronApp,
    claudeStub
  }) => {
    const { composer, send: sendButton } = await openStubChat(page, claudeStub.command)
    const chat = page.locator('[data-native-chat-root="true"]')
    await send(page, composer, sendButton, 'shell-task:background')

    const strip = chat.locator('[data-native-chat-background-tasks]')
    await expect(strip).toBeVisible({ timeout: 30_000 })
    const header = strip.locator('button[aria-expanded]')
    if ((await header.getAttribute('aria-expanded')) === 'false') {
      await header.click()
    }
    const openRow = strip.getByRole('button', { name: /Show output of Build the web bundle/ })
    await expect(openRow).toBeVisible({ timeout: 30_000 })
    await shot(page, '01-strip-open-mark')

    await openRow.click()
    const view = chat.getByRole('log', { name: /^Output of Build the web bundle/ })
    await expect(view).toBeVisible()
    await expect.poll(() => terminalText(view), { timeout: 30_000 }).toContain('bundle step 2')
    const early = await terminalText(view)
    await shot(page, '02-view-live')
    await expect
      .poll(async () => (await terminalText(view)).length, { timeout: 30_000 })
      .toBeGreaterThan(early.length)
    await shot(page, '03-view-grown')

    // Esc returns to the conversation; the inline row's open mark reopens it; Back returns again.
    await view.click()
    await page.keyboard.press('Escape')
    await expect(view).toHaveCount(0)
    await shot(page, '04-after-escape')
    const inlineOpen = chat
      .locator('[data-native-chat-scroll]')
      .getByRole('button', { name: /Show output of Build the web bundle/ })
    await inlineOpen.first().click()
    await expect(view).toBeVisible()
    await chat.getByRole('button', { name: 'Back to main agent' }).click()
    await expect(view).toHaveCount(0)

    // Resize: the terminal re-fits to the window's width.
    await openRow.click()
    await expect(view).toBeVisible()
    const widthAt = async (width: number) => {
      await electronApp.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setSize(size, 860)
      }, width)
      await expect
        .poll(() =>
          view.evaluate((element) => element.querySelector('.xterm-screen')?.clientWidth ?? 0)
        )
        .toBeGreaterThan(0)
      return view.evaluate((element) => element.querySelector('.xterm-screen')?.clientWidth ?? 0)
    }
    const narrow = await widthAt(760)
    await shot(page, '05-resized-narrow')
    const wide = await widthAt(1400)
    await shot(page, '06-resized-wide')
    expect(wide).toBeGreaterThan(narrow)

    // The end: the view keeps everything and the bar says it finished.
    await expect.poll(() => terminalText(view), { timeout: 60_000 }).toContain('exited with code 0')
    await expect(chat.getByText('Completed', { exact: true }).first()).toBeVisible({
      timeout: 30_000
    })
    await shot(page, '07-ended')
  })

  test('a foreground command streams under its row, then hands over to its result', async ({
    orcaPage: page,
    claudeStub
  }) => {
    const { composer, send: sendButton } = await openStubChat(page, claudeStub.command)
    const chat = page.locator('[data-native-chat-root="true"]')
    const scroller = chat.locator('[data-native-chat-scroll]').first()
    const sentAt = Date.now()
    await send(page, composer, sendButton, 'shell-task:foreground')

    const tail = chat.getByRole('log', { name: /^Live output of pnpm test/ })
    await expect(tail).toBeVisible({ timeout: 30_000 })
    const appearedAfterMs = Date.now() - sentAt
    await shot(page, '10-tail-appears')

    // Stick to bottom while the tail grows: still pinned once it has grown, and again later.
    const gapFromBottom = () =>
      scroller.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      )
    await expect.poll(() => terminalText(tail), { timeout: 30_000 }).toContain('shard 1 step 3')
    expect(await gapFromBottom()).toBeLessThan(4)
    await expect.poll(() => terminalText(tail), { timeout: 30_000 }).toContain('shard 1 step 8')
    expect(await gapFromBottom()).toBeLessThan(4)
    await shot(page, '11-tail-growing')

    await expect(chat.getByText('All commands finished.')).toBeVisible({ timeout: 60_000 })
    await expect(tail).toHaveCount(0)
    await shot(page, '12-handed-over')
    test.info().annotations.push({ type: 'tail-appeared-ms', description: String(appearedAfterMs) })
  })

  test('a running row scrolled out of view returns with the same height and output', async ({
    orcaPage: page,
    claudeStub
  }) => {
    const { composer, send: sendButton, stop } = await openStubChat(page, claudeStub.command)
    const chat = page.locator('[data-native-chat-root="true"]')
    const scroller = chat.locator('[data-native-chat-scroll]').first()
    // History above, so the running row can leave the list's window.
    for (let turn = 0; turn < 12; turn++) {
      await send(page, composer, sendButton, `history ${turn} ${'words '.repeat(60)}`)
      // Older replies leave the virtualised list, so wait on the turn's own message, then its end.
      await expect(chat.getByText(`history ${turn} words`).first()).toBeVisible({ timeout: 30_000 })
      await expect(stop).toHaveCount(0, { timeout: 30_000 })
    }
    await send(page, composer, sendButton, 'shell-task:foreground')
    const tail = chat.getByRole('log', { name: /^Live output of pnpm test/ })
    await expect(tail).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => terminalText(tail), { timeout: 30_000 }).toContain('shard 1 step 3')
    const before = {
      height: await tail.evaluate((element) => element.getBoundingClientRect().height),
      text: await terminalText(tail)
    }
    await shot(page, '20-before-scroll-away')

    await scroller.evaluate((element) => element.scrollTo({ top: 0 }))
    // Far enough that the list unmounts the running row: the remount is what this test is about.
    await expect(tail).toHaveCount(0, { timeout: 15_000 })
    await shot(page, '21-scrolled-away')
    await scroller.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
    await expect(tail).toBeVisible()
    const after = {
      height: await tail.evaluate((element) => element.getBoundingClientRect().height),
      text: await terminalText(tail)
    }
    await shot(page, '22-scrolled-back')
    expect(after.height).toBe(before.height)
    // Earlier output is still shown, not restarted from an empty terminal.
    expect(after.text).toContain('shard 1 step 1')
  })

  test('more than three concurrent commands keep three terminals and offer the rest', async ({
    orcaPage: page,
    claudeStub
  }) => {
    const { composer, send: sendButton } = await openStubChat(page, claudeStub.command)
    const chat = page.locator('[data-native-chat-root="true"]')
    await send(page, composer, sendButton, 'shell-task:foreground-many')
    const tails = chat.getByRole('log', { name: /^Live output of pnpm test/ })
    const offers = chat.getByRole('button', { name: 'Show live output' })
    await expect(tails).toHaveCount(3, { timeout: 30_000 })
    await expect(offers).toHaveCount(2, { timeout: 30_000 })
    await shot(page, '30-over-cap')

    await offers.first().click()
    const view = chat.getByRole('log', { name: /^Output of pnpm test/ })
    await expect(view).toBeVisible()
    await expect.poll(() => terminalText(view), { timeout: 30_000 }).toContain('step')
    await shot(page, '31-over-cap-opened')
    await page.keyboard.press('Escape')
    await expect(chat.getByText('All commands finished.')).toBeVisible({ timeout: 60_000 })
  })
})
