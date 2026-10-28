import { expect, test } from 'claude-code/testing'

import { typing0 as blockFrame } from '../hooks/puppy-blocks'

import type { View } from '../types'

const PANE = {
  plugin: 'puppy-skills',
  component: 'Pane',
  requestId: 'puppy-skills',
  props: {
    title: 'skills',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const VIEW: View = {
  skills: [
    { id: 'personal::nap', name: 'nap', description: 'Finds a sunny spot. Then naps a long time.', where: 'personal', group: '', dir: '', uses: [] },
    {
      id: 'repo:garden:dig-hole', name: 'dig-hole', description: 'Digs one hole. Never two.', where: 'repo', group: 'garden', dir: '',
      uses: [{ task: 'morning dig', when: '9:00 daily' }],
    },
  ],
  openIds: [],
  isShowingSynced: false,
  at: Date.parse('2026-10-27T10:00:00Z'),
  notes: [],
}

test('the pane: a card per place, the first sentence, a clock on the scheduled one', async ($, on) => {
  on('state.get', () => ({ value: { value: VIEW, version: 1 } }))
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /2 skills/ }))?.text).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeTruthy()
    expect(await ui.find({ type: 'Box', key: 'card-personal' })).toBeTruthy()
    expect(await ui.find({ type: 'Box', key: 'card-repo-garden' })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /only in garden/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /⏰ 9:00/ }))?.text).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Never two/ })).toBeFalsy()
    if (surface !== 'terminal') {
      expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('the puppy typing at its laptop')
    }
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')).not.toContain('ᴥ')
    await ui.unmount()
  }
})

test('unfolded: the whole description and the schedule', async ($, on) => {
  on('state.get', () => ({ value: { value: { ...VIEW, openIds: ['repo:garden:dig-hole'] }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Never two/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /morning dig · 9:00 daily/ }))?.text).toBeTruthy()
  // read only: nothing to run
  expect(await ui.find({ type: 'Button', text: /run/ })).toBeFalsy()
  await ui.unmount()
})

test('a long first sentence is cut, not the whole paragraph', async ($, on) => {
  const long = { ...VIEW.skills[0], id: 'personal::docs', name: 'docs', description: `docs (${'word '.repeat(80)}) and more` }
  on('state.get', () => ({ value: { value: { ...VIEW, skills: [long] }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = (await ui.findAll({ type: 'Text' })).map(t => t.text).find(t => t.startsWith('docs'))
  expect(row?.endsWith('…')).toBe(true)
  expect((row?.length ?? 0) < 130).toBe(true)
  await ui.unmount()
})

const SYNCED = { id: 'synced::pdf', name: 'pdf', description: 'Reads PDFs.', where: 'synced', group: '', dir: '', uses: [] } as const

test('claude.ai skills stay folded below yours, and are not counted as yours', async ($, on) => {
  on('state.get', () => ({ value: { value: { ...VIEW, skills: [...VIEW.skills, SYNCED] }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /2 skills/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^yours$/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Button', key: 'show-synced' }))?.text).toContain('from claude.ai 1')
  expect(await ui.find({ type: 'Box', key: 'card-synced' })).toBeFalsy()
  await ui.unmount()
})

test('unfolded: the claude.ai card', async ($, on) => {
  on('state.get', () => ({ value: { value: { ...VIEW, skills: [SYNCED], isShowingSynced: true }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Box', key: 'card-synced' })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /no skills of your own yet/ }))?.text).toBeTruthy()
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
      expect(texts.findIndex(t => t.text.includes('2 skills'))).toBeGreaterThan(12)
    } else {
      expect(puppy).toBeFalsy()
      expect(texts[0].text).toContain('2 skills')
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
