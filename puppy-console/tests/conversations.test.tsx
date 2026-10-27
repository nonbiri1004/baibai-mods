import { expect, mock, test } from 'claude-code/testing'

import { KEEP_MS, nameOf, parseConversation, plain, recapOf, recent, RUNNING_MS, shownState } from '../hooks/sessions'

const T = Date.parse('2026-10-27T12:00:00.000Z')
const user = (text: string) => ({ role: 'user' as const, text, toolUses: [] })
const results = { role: 'user' as const, text: '', toolUses: [], toolResults: [{}] }
const said = (text: string, ...toolUses: { tool: string; input: Record<string, unknown> }[]) =>
  ({ role: 'assistant' as const, text, toolUses })
const wrapUp = (input: Record<string, unknown>) => ({ tool: 'mcp__ccd_turn__wrap_up', input })
const conv = (over: object) => JSON.stringify({
  format: 'session-status', version: 1, id: 'a', updated: new Date(T).toISOString(),
  state: 'done', title: 'fix the bowl', recap: 'done.', ask: null, ...over,
})

test('the name is the first thing the person typed, without the app\'s tags', () => {
  const first = '<system-reminder>\nrules\n</system-reminder><command-name>/todo</command-name>\n\n我想到一個就是 console 裡放對話摘要'
  expect(plain(first)).toBe('我想到一個就是 console 裡放對話摘要')
  expect(nameOf([user(first), said('ok'), user('next')])).toBe('我想到一個就是 console 裡放對話摘要')
  expect(nameOf([])).toBe('new conversation')
  expect([...nameOf([user('x'.repeat(200))])]).toHaveLength(60)
})

test('the recap is this turn\'s wrap_up; an older one is not used', () => {
  const turn = [
    user('first'), said('', wrapUp({ recap: 'old recap', ask: 'old ask?' })),
    user('second'), said('working', { tool: 'Bash', input: {} }), results,
    said('', wrapUp({ recap: 'Card added. Tests pass.', ask: 'Open a PR?' })), said('The card is in.'),
  ]
  expect(recapOf(turn, 'The card is in.')).toEqual({ recap: 'Card added. Tests pass.', ask: 'Open a PR?' })
  // no wrap_up this turn (the terminal, a short answer): the answer's first line, nothing asked
  expect(recapOf([...turn, user('third'), said('Yes.\nmore')], 'Yes.\nmore')).toEqual({ recap: 'Yes.', ask: null })
})

test('a conversation file parses; a wrong one throws', () => {
  expect(parseConversation(conv({ ask: 'PR?', project: 'puppy-mods' }))).toMatchObject({ id: 'a', ask: 'PR?', project: 'puppy-mods' })
  expect(() => parseConversation(conv({ format: 'pipeline-status' }))).toThrow()
  expect(() => parseConversation(conv({ state: 'busy' }))).toThrow()
  expect(() => parseConversation('{')).toThrow()
})

test('waiting first, newest first; old ones leave; a forgotten "running" is done', () => {
  const at = (ms: number) => new Date(T - ms).toISOString()
  const list = [
    parseConversation(conv({ id: 'done', state: 'done', updated: at(60_000) })),
    parseConversation(conv({ id: 'w-old', state: 'waiting', updated: at(3_600_000) })),
    parseConversation(conv({ id: 'w-new', state: 'waiting', updated: at(120_000) })),
    parseConversation(conv({ id: 'gone', state: 'waiting', updated: at(KEEP_MS + 1) })),
    parseConversation(conv({ id: 'run', state: 'running', updated: at(30_000) })),
  ]
  expect(recent(list, T).map(c => c.id)).toEqual(['w-new', 'w-old', 'run', 'done'])
  expect(shownState(parseConversation(conv({ state: 'running', updated: at(RUNNING_MS + 1) })), T)).toBe('done')
})

const PANE = {
  plugin: 'puppy-console',
  component: 'Pane',
  requestId: 'puppy-console',
  props: { title: 'console', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const entry = (name: string, kind: 'file' | 'dir' = 'file') => ({ name, kind, size: 1, mtimeMs: 0, isLink: false })

test('the conversations card comes first, with what each one asks', { options: { status_dir: '/s' } }, async ($, on) => {
  const files: Record<string, string> = {
    '/s/sessions/a.json': conv({ id: 'a', state: 'waiting', title: 'console sessions', recap: 'Card added.', ask: 'Open a PR?' }),
    '/s/sessions/b.json': conv({ id: 'b', state: 'done', title: 'fix the bowl' }),
    '/s/sessions/c.json': conv({ id: 'x' }),   // name and id disagree: left out
    '/s/music.json': JSON.stringify({ format: 'pipeline-status', version: 1, pipeline: 'music', updated: new Date(T).toISOString(), state: 'waiting', headline: '05 · 42/70' }),
  }
  mock.env(on, { HOME: '/home/me' })
  mock.clock(on, { now: T + 60_000 })
  on('fs.list', (_, e) => ({
    value: (e as { path: string }).path === '/s/sessions'
      ? ['a.json', 'b.json', 'c.json'].map(n => entry(n))
      : [entry('music.json'), entry('sessions', 'dir')],
  }))
  on('fs.read', (_, e) => {
    const text = files[(e as { path: string }).path]
    if (text == null) throw new Error('missing')
    return { value: text }
  })
  on('command.register', () => ({ value: { command: 'console' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'console', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.indexOf('conversations')).toBeLessThan(texts.indexOf('music'))
    expect(texts).toContain('→ Open a PR?')
    expect(texts).toContain('Card added.')
    expect(texts.some(t => /fix the bowl · done/.test(t ?? ''))).toBe(true)
    expect(texts.some(t => /^x\b/.test(t ?? ''))).toBe(false)
    await ui.unmount()
  }
})

test('a turn writes this conversation\'s own file: running, then where it stands', { options: { status_dir: '~/status' } }, async ($, on) => {
  const written: Record<string, string> = {}
  let messages: (ReturnType<typeof user> | ReturnType<typeof said>)[] = [user('<system-reminder>x</system-reminder>add the card')]
  mock.env(on, { HOME: '/home/me' })
  mock.clock(on, { now: T })
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_, e) => { const { path, text } = e as { path: string; text: string }; written[path] = text; return { value: undefined } })
  on('session.id', () => ({ value: 'abc' }))
  on('session.root', () => ({ value: '/Users/me/dev/puppy-mods' }))
  on('session.messages', () => ({ value: messages as never }))
  on('command.register', () => ({ value: { command: 'console' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const path = '/home/me/status/sessions/abc.json'
  await $.turn.start({ text: 'add the card', turnId: 't1' })
  expect(parseConversation(written[path]!)).toMatchObject({ state: 'running', title: 'add the card', project: 'puppy-mods', recap: '' })

  messages = [...messages, said('', wrapUp({ recap: 'Card added.', ask: 'Open a PR?' }))]
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(parseConversation(written[path]!)).toMatchObject({ state: 'waiting', recap: 'Card added.', ask: 'Open a PR?' })

  // the next turn starts: running, still saying where it stood
  await $.turn.start({ text: 'yes', turnId: 't2' })
  expect(parseConversation(written[path]!)).toMatchObject({ state: 'running', recap: 'Card added.', ask: null })

  // a subagent's turn is not this conversation's
  delete written[path]
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer', agentId: 'sub' })
  expect(written[path]).toBeUndefined()
})

test('conversations off: nothing is written', { options: { status_dir: '/s', conversations: 'off' } }, async ($, on) => {
  let writes = 0
  mock.env(on, { HOME: '/home/me' })
  mock.clock(on, { now: T })
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => { writes++; return { value: undefined } })
  on('command.register', () => ({ value: { command: 'console' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(writes).toBe(0)
})
