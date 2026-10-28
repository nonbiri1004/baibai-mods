import { expect, test } from 'claude-code/testing'

import { sleep0, sit as blockFrame } from '../hooks/puppy-blocks'

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

const NOW = Date.parse('2026-10-27T10:00:00Z')
const item = (over: Partial<Item>): Item => ({ id: 'a', text: 'a', project: 'p', kind: 'todo', status: 'open', createdAt: '', ...over })

const VIEW: View = {
  items: [
    item({ id: 'vet', text: 'call the vet about the shots' }),
    item({ id: 'plants', text: 'water the plants' }),
    item({ id: 'gone', text: 'an old idea', deletedAt: '2026-10-27T09:00:00Z' }),
    item({ id: 'food', text: 'buy food', status: 'done', doneAt: '2026-10-27T09:00:00Z' }),
  ],
  isShowingDone: false,
  at: NOW,
  notes: [],
}

test('the pane: one list with a tick and ✕ on each row, the add field, done folded', async ($, on) => {
  // a call on $ is answered { value }: here the state read's own { value, version }
  on('state.get', () => ({ value: { value: VIEW, version: 1 } }))

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /2 to-do/ }))?.text).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeTruthy()
    expect(await ui.find({ type: 'Box', key: 'card-list' })).toBeTruthy()
    for (const id of ['vet', 'plants']) {
      expect((await ui.find({ type: 'Button', key: `tick-${id}` }))?.text).toBe('○')
      expect((await ui.find({ type: 'Button', key: `del-${id}` }))?.text).toBe('✕')
    }
    // the whole words, not cut
    expect((await ui.find({ type: 'Text', text: /^call the vet about the shots$/ }))?.text).toBeTruthy()
    // deleted never shows; done is folded
    expect(await ui.find({ type: 'Text', text: /an old idea/ })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /buy food/ })).toBeFalsy()
    expect((await ui.find({ type: 'Button', key: 'show-done' }))?.text).toContain('done 1')
    // nothing from other conversations, no tidy up, no questions
    const words = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
    expect(words).not.toContain('ᴥ')
    if (surface === 'desktop') {
      expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('the puppy sitting at its laptop')
    }
    expect(/asked you|tidy up|waiting for merge|this conversation/.test(words)).toBe(false)
    await ui.unmount()
  }
  // the phone draws no field yet; the others do
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ type: 'Input', key: 'add' })).toBeTruthy()
  await desk.unmount()
})

test('unfolded: done items can be ticked open again', async ($, on) => {
  on('state.get', () => ({ value: { value: { ...VIEW, isShowingDone: true }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'untick-food' }))?.text).toBe('☑')
  expect((await ui.find({ type: 'Text', text: /buy food/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('nothing open: the puppy naps', async ($, on) => {
  on('state.get', () => ({ value: { value: { ...VIEW, items: [] }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /all clear/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /the puppy naps/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('a view kept from an older version still draws', async ($, on) => {
  // 0.6.0 kept here, talks, convos…; the list only needs items and at
  const old = { here: { id: 's' }, talks: [], convos: null, items: VIEW.items, prStates: {}, isShowingConvos: false, at: NOW, notes: [] }
  on('state.get', () => ({ value: { value: old, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'tick-vet' })).toBeTruthy()
  await ui.unmount()
})

test('terminal: the full still puppy is above the header only when tall enough', async ($, on) => {
  on('state.get', () => ({ value: { value: VIEW, version: 1 } }))
  for (const bodyRows of [40, 26, 25, 20]) {
    const ui = await $.ui.mount({
      ...PANE, surface: 'terminal',
      props: { ...PANE.props, scroll: { offset: 0, bodyRows } },
    })
    const texts = await ui.findAll({ type: 'Text' })
    const puppy = await ui.find({ type: 'Box', key: 'puppy' })
    if (bodyRows >= 26) {
      expect(puppy?.children.length).toBe(13)
      for (let i = 0; i < 13; i++) {
        const row = puppy!.children[i]
        expect(row.type).toBe('Text')
        expect((row.children ?? []).map(run => run.children.join('')).join('')).toBe(blockFrame[i].map(([text]) => text).join(''))
        expect((row.children ?? []).map(run => [run.children.join(''), run.props?.color ?? null, run.props?.backgroundColor ?? null])).toEqual(blockFrame[i])
      }
      expect(texts[0].text).toBe(blockFrame[0].map(([text]) => text).join(''))
      expect(texts.findIndex(t => t.text.includes('2 to-do'))).toBeGreaterThan(12)
    } else {
      expect(puppy).toBeFalsy()
      expect(texts[0].text).toContain('2 to-do')
    }
    expect(await ui.find({ type: 'Svg' })).toBeFalsy()
    expect(texts.map(t => t.text).join(' ')).not.toContain('ᴥ')
    await ui.unmount()
  }
})

test('loading is plain text on every surface', async ($, on) => {
  on('state.get', () => ({ value: { value: { ...VIEW, at: null }, version: 1 } }))
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['loading…'])
    await ui.unmount()
  }
})

test('nothing open: desktop sleeps and terminal uses the sleeping still', async ($, on) => {
  on('state.get', () => ({ value: { value: { ...VIEW, items: VIEW.items.filter(i => i.status === 'done') }, version: 1 } }))
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'desktop') {
      expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('the puppy sleeping at its laptop')
    } else {
      const puppy = await ui.find({ type: 'Box', key: 'puppy' })
      expect(puppy?.children.length).toBe(13)
      for (let i = 0; i < 13; i++) {
        expect((puppy!.children[i].children ?? []).map(run => run.children.join('')).join('')).toBe(sleep0[i].map(([text]) => text).join(''))
      }
    }
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')).not.toContain('ᴥ')
    await ui.unmount()
  }
})
