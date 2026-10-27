import { expect, test } from 'claude-code/testing'

import type { Item, View } from '../types'

const PANE = {
  plugin: 'puppy-todo',
  component: 'Pane',
  requestId: 'puppy-todo',
  props: {
    title: 'todo',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-10-25T10:00:00Z')
const item = (over: Partial<Item>): Item => ({ id: 'a', text: 'a', project: 'p', kind: 'todo', status: 'open', createdAt: '', ...over })
const prItem = item({
  id: 'pr',
  text: 'merge the notes PR',
  schemaVersion: 2,
  source: { type: 'github-pr', host: 'github.com', repo: 'you/app', number: 8 },
  completion: { mode: 'source', condition: 'merged' },
  link: 'https://github.com/you/app/pull/8',
})

const VIEW: View = {
  here: { id: 's2', title: 'notes', project: 'app', cwd: '/x', recap: 'built the list' },
  talks: [{ id: 't', title: 'games', titles: ['games'], project: 'g', cwd: '/g', ask: 'make the office?', askId: 'toolu_1', prs: [], mtimeMs: NOW - 3_600_000 }],
  items: [
    item({ id: 'mine', text: 'call the vet', createdAt: '2026-10-15T10:00:00Z', session: { id: 's1', title: 'notes', cwd: '/x' } }),
    item({ id: 'new', text: 'water the plants', project: 'home', createdAt: '2026-10-25T08:00:00Z' }),
    // the same project as this conversation, written by another one
    item({ id: 'sib', text: 'write the docs', project: 'app', session: { id: 's9', title: 'docs', cwd: '/y' } }),
    prItem,
    item({ id: 'gone', text: 'an old idea', deletedAt: '2026-10-25T09:00:00Z' }),
    item({ id: 'did', text: 'buy food', status: 'done', doneAt: '2026-10-25T09:00:00Z' }),
  ],
  prStates: { 'github.com/you/app#8': { state: 'OPEN' } },
  convos: [
    {
      session: { id: 'local_a', title: 'shelf listing', cwd: '/x', isArchived: false, isPinned: true, lastActivityMs: 0 },
      recap: 'listed it',
      verdict: { state: 'clear', reasons: [] },
    },
    {
      session: { id: 'local_b', title: 'games', cwd: '/g', isArchived: false, isPinned: true, lastActivityMs: 0 },
      verdict: { state: 'open', reasons: ['asked you: make the office?'] },
    },
  ],
  isShowingDone: false,
  isShowingConvos: false,
  isShowingAllAsks: false,
  isShowingInProject: false,
  openProjects: [],
  openItem: null,
  convosAt: NOW - 60_000,
  at: NOW,
  notes: [],
}

test('the pane: asks first, this project open, other projects one line each, the rest folded', async ($, on) => {
  // a call on $ is answered { value }: here the state read's own { value, version }
  on('state.get', () => ({ value: { value: VIEW, version: 1 } }))

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /4 to-do · 1 asked you/ }))?.text).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeTruthy()
    // each part is a card (STYLE.md); no summary line, no card per project
    for (const key of ['card-asks', 'card-here', 'card-projects']) expect(await ui.find({ type: 'Box', key })).toBeTruthy()
    for (const key of ['summary', 'card-todo', 'card-p-home']) expect(await ui.find({ type: 'Box', key })).toBeFalsy()
    expect((await ui.find({ type: 'Text', text: /1 waiting/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /make the office\?/ }))?.text).toBeTruthy()
    // this project: its last recap, then this conversation's items with a tick and a ⋯, no ✕ until asked
    expect((await ui.find({ type: 'Text', text: /last: built the list/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Button', key: 'tick-mine' }))?.text).toBe('○')
    expect(await ui.find({ type: 'Button', key: 'more-mine' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'del-mine' })).toBeFalsy()
    // the project's other conversations are folded
    expect((await ui.find({ type: 'Button', key: 'show-in-project' }))?.text).toContain('other conversations')
    expect(await ui.find({ type: 'Button', key: 'tick-sib' })).toBeFalsy()
    // every other project is one folded line with its count
    expect((await ui.find({ type: 'Button', key: 'show-p-home' }))?.text).toContain('home')
    expect(await ui.find({ type: 'Button', key: 'show-p-p' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'tick-new' })).toBeFalsy()
    // no old-item warning, no "waiting for merge" words: ↗ says it
    expect(await ui.find({ type: 'Text', text: /older than|waiting for merge/ })).toBeFalsy()
    // deleted never shows; done and tidy-up are folded
    expect(await ui.find({ type: 'Text', text: /an old idea/ })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /buy food/ })).toBeFalsy()
    expect((await ui.find({ type: 'Button', key: 'show-done' }))?.text).toContain('done 1')
    expect((await ui.find({ type: 'Button', key: 'show-convos' }))?.text).toContain('1 of 2 conversations have nothing open')
    // nothing in the pane archives or skips
    const labels = (await ui.findAll({ type: 'Button' })).map(b => b.text)
    expect(labels.some(l => /archive|skip/.test(l))).toBe(false)
    await ui.unmount()
  }
})

test('opened: other projects show their rows, a PR row has no tick, ⋯ shows the whole item and delete', async ($, on) => {
  const opened: View = { ...VIEW, isShowingInProject: true, openProjects: ['home', 'p'], openItem: 'mine' }
  on('state.get', () => ({ value: { value: opened, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'tick-sib' })).toBeTruthy()
  expect((await ui.find({ type: 'Button', key: 'tick-new' }))?.text).toBe('○')
  expect((await ui.find({ type: 'Text', text: /^2h$/ }))?.text).toBeTruthy()
  // the row may get narrower than its words, so long words cut instead of pushing the age out
  expect((await ui.find({ type: 'Box', key: 'r-new' }))?.props).toMatchObject({ flexGrow: 1, flexShrink: 1, minWidth: 0 })
  // the PR row waits for github: no tick, no delete, a short link
  expect(await ui.find({ type: 'Button', key: 'tick-pr' })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /^#8$/ }))?.text).toBeTruthy()
  // ⋯ on "call the vet": where it came from, when, and delete
  expect((await ui.find({ type: 'Text', text: /from notes · added 2026-10-15/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Button', key: 'del-mine' }))?.text).toBe('delete')
  await ui.unmount()
})

test('more than three questions: the rest behind a fold', async ($, on) => {
  const talk = (n: number) => ({ ...VIEW.talks[0]!, id: `t${n}`, title: `chat ${n}`, titles: [`chat ${n}`], mtimeMs: NOW - n * 60_000 })
  let isShowingAllAsks = false
  on('state.get', () => ({ value: { value: { ...VIEW, talks: [1, 2, 3, 4].map(talk), isShowingAllAsks }, version: 1 } }))
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'more-asks' }))?.text).toBe('▸ more')
  expect(await ui.find({ type: 'Text', text: /chat 4/ })).toBeFalsy()
  await ui.unmount()
  isShowingAllAsks = true
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /chat 4/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('folded tidy up shows no count it hasn\'t worked out lately', async ($, on) => {
  let convosAt: number | undefined
  on('state.get', () => ({ value: { value: { ...VIEW, convosAt }, version: 1 } }))
  // never worked out, and worked out ten minutes ago
  for (const at of [undefined, NOW - 10 * 60_000]) {
    convosAt = at
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Button', key: 'show-convos' }))?.text).toBe('▸ tidy up')
    await ui.unmount()
  }
})

test('unfolded: done items can be unticked, tidy-up lists facts and recaps without buttons', async ($, on) => {
  on('state.get', () => ({ value: { value: { ...VIEW, isShowingDone: true, isShowingConvos: true }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'untick-did' })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /nothing open found is a hint/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /last: listed it/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /asked you: make the office\?/ }))?.text).toBeTruthy()
  await ui.unmount()
})
