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
})

const VIEW: View = {
  here: { id: 's2', title: 'notes', project: 'app', cwd: '/x', recap: 'built the list' },
  talks: [{ id: 't', title: 'games', titles: ['games'], project: 'g', cwd: '/g', ask: 'make the office?', askId: 'toolu_1', prs: [], mtimeMs: NOW - 3_600_000 }],
  items: [
    item({ id: 'mine', text: 'call the vet', createdAt: '2026-10-15T10:00:00Z', session: { id: 's1', title: 'notes', cwd: '/x' } }),
    item({ id: 'new', text: 'water the plants', project: 'home', createdAt: '2026-10-25T08:00:00Z' }),
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
  at: NOW,
  notes: [],
}

test('the pane: tick and ✕ on to-dos, no buttons on PR rows, done and tidy-up folded', async ($, on) => {
  // a call on $ is answered { value }: here the state read's own { value, version }
  on('state.get', () => ({ value: { value: VIEW, version: 1 } }))

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /3 to-do · 1 asked you/ }))?.text).toBeTruthy()
    // each part is a card (STYLE.md); refresh sits on the first row
    for (const key of ['card-here', 'card-asks', 'card-todo']) expect(await ui.find({ type: 'Box', key })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /1 waiting/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /3 open/ }))?.text).toBeTruthy()
    // the summary under the first row: what waits for merge, what is open, what is old
    expect(await ui.find({ type: 'Box', key: 'summary' })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /↗ 1 waiting for merge/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /○ 2 open/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /^1 item older than 7 days$/ }))?.text).toBeTruthy()
    // each project is its own card with a grey bar; an open to-do ticks with ○ and shows its age
    expect(await ui.find({ type: 'Box', key: 'card-p-home' })).toBeTruthy()
    expect(await ui.find({ type: 'Box', key: 'bar-p-home-new' })).toBeTruthy()
    // an old item gets a mark beside its age
    expect(await ui.find({ type: 'Box', key: 'old-mine' })).toBeTruthy()
    expect(await ui.find({ type: 'Box', key: 'old-new' })).toBeFalsy()
    expect((await ui.find({ type: 'Button', key: 'tick-new' }))?.text).toBe('○')
    expect((await ui.find({ type: 'Text', text: /^2h$/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /^10d$/ }))?.text).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /last: built the list/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /make the office\?/ }))?.text).toBeTruthy()
    // an item from an earlier session of this conversation is here, with a tick and a ✕
    expect(await ui.find({ type: 'Button', key: 'tick-mine' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'del-mine' })).toBeTruthy()
    // the PR row waits for github: no tick, no ✕
    expect((await ui.find({ type: 'Text', text: /^waiting for merge$/ }))?.text).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'tick-pr' })).toBeFalsy()
    expect(await ui.find({ type: 'Button', key: 'del-pr' })).toBeFalsy()
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

test('unfolded: done items can be unticked, tidy-up lists facts and recaps without buttons', async ($, on) => {
  on('state.get', () => ({ value: { value: { ...VIEW, isShowingDone: true, isShowingConvos: true }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'untick-did' })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /nothing open found is a hint/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /last: listed it/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /asked you: make the office\?/ }))?.text).toBeTruthy()
  await ui.unmount()
})
