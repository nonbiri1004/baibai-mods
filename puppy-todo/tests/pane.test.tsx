import { expect, test } from 'claude-code/testing'

import type { Item, View } from '../types'
import { attentionFile, occurrence, target } from '../hooks/todo'

const PANE = {
  plugin: 'puppy-todo',
  component: 'Pane',
  requestId: 'puppy-todo',
  props: {
    title: 'todo',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const item = (over: Partial<Item>): Item => ({ id: 'a', text: 'a', project: 'p', kind: 'todo', status: 'open', createdAt: '', ...over })
const skippedItem = item({ id: 'old', text: 'an old thing', project: 'q' })
const prItem = item({
  id: 'pr',
  text: 'merge the notes PR',
  schemaVersion: 2,
  source: { type: 'github-pr', host: 'github.com', repo: 'you/app', number: 8 },
  completion: { mode: 'source', condition: 'merged' },
  status: 'done',
})

const VIEW: View = {
  here: { id: 's2', title: 'notes', project: 'app', cwd: '/x' },
  talks: [{ id: 't', title: 'games', titles: ['games'], project: 'g', cwd: '/g', ask: 'make the office?', askId: 'toolu_1', prs: [], mtimeMs: 0 }],
  prs: [],
  items: [item({ id: 'mine', text: 'call the vet', session: { id: 's1', title: 'notes', cwd: '/x' } }), prItem, skippedItem],
  prStates: { 'github.com/you/app#8': { state: 'OPEN' } },
  attention: {
    [target.item(skippedItem)]: {
      version: 1,
      target: target.item(skippedItem),
      state: 'dismissed',
      occurrence: occurrence.item(skippedItem),
      at: '',
      by: 'person',
    },
  },
  isShowingSkipped: false,
  convos: null,
  archiving: {},
  at: Date.parse('2026-10-25T10:00:00Z'),
  notes: [],
}

test('the pane has skip, never a done button, on every surface', async ($, on) => {
  // the engine beneath answers the pane's read of its state with a filled view
  // a call on $ is answered { value }: here the state read's own { value, version }
  on('state.get', () => ({ value: { value: VIEW, version: 1 } }))
  expect(attentionFile(target.item(skippedItem))).toMatch(/\.json$/)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // the face counts the skipped row instead of saying all clear
    expect((await ui.find({ type: 'Text', text: /waiting on you · 1 skipped/ }))?.text).toBeTruthy()
    // an item from an earlier session of this conversation shows under this conversation
    expect((await ui.find({ type: 'Text', text: /call the vet/ }))?.text).toBeTruthy()
    // the PR item is open although its file says done: github said open
    expect((await ui.find({ type: 'Text', text: /merge the notes PR · done when the PR merges/ }))?.text).toBeTruthy()
    // the skipped row is hidden, behind the skipped button
    expect(await ui.find({ type: 'Text', text: /an old thing/ })).toBeFalsy()
    expect(await ui.find({ type: 'Button', key: 'show-skipped' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: `skip-${target.item(prItem)}` })).toBeTruthy()
    // no tick anywhere
    expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).not.toContain('○')
    await ui.unmount()
  }
})

test('Codex #3: a skipped PR item that merged shows as done, and is not counted as skipped', async ($, on) => {
  const merged: View = {
    ...VIEW,
    talks: [],
    items: [prItem],
    prStates: { 'github.com/you/app#8': { state: 'MERGED', endedAt: '2026-10-25T09:00:00Z' } },
    attention: {
      [target.item(prItem)]: {
        version: 1,
        target: target.item(prItem),
        state: 'dismissed',
        occurrence: occurrence.item(prItem),
        at: '',
        by: 'person',
      },
    },
  }
  on('state.get', () => ({ value: { value: merged, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /all clear/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /merge the notes PR · merged/ }))?.text).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'show-skipped' })).toBeFalsy()
  await ui.unmount()
})

test('conversations: archive only on a ready row, reasons on the others', async ($, on) => {
  const session = (id: string, title: string) => ({ id, title, cwd: '/x', isArchived: false, isPinned: true, lastActivityMs: 0 })
  const withConvos: View = {
    ...VIEW,
    convos: [
      { session: session('local_a', 'shelf listing'), recap: 'listed it', verdict: { state: 'ready', reasons: [] } },
      { session: session('local_b', 'games chat'), verdict: { state: 'open', reasons: ['asked you: prototype?', '2 open to-dos'] } },
      { session: session('local_c', 'weekly news'), verdict: { state: 'unknown', reasons: ['could not find its last turn'] } },
    ],
  }
  on('state.get', () => ({ value: { value: withConvos, version: 1 } }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'archive-local_a' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'archive-local_b' })).toBeFalsy()
    expect(await ui.find({ type: 'Button', key: 'archive-local_c' })).toBeFalsy()
    expect((await ui.find({ type: 'Text', text: /asked you: prototype\? · 2 open to-dos/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /1 can be archived/ }))?.text).toBeTruthy()
    await ui.unmount()
  }
})
