import { expect, test } from 'claude-code/testing'

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
    // the typing puppy where pictures draw, the face on the terminal
    if (surface === 'terminal') {
      expect((await ui.find({ type: 'Text', text: /•ᴥ•/ }))?.text).toBeTruthy()
    } else {
      const pic = await ui.find({ type: 'Svg' })
      expect(pic).toBeTruthy()
    }
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
