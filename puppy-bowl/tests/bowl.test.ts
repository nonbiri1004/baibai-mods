import { expect, mock, test } from 'claude-code/testing'

import { food, isShown, nextMode } from '../hooks/register'

test('the bowl empties as context fills', () => {
  expect(food(0)).toBe('●●●●●●●●●●')
  expect(food(30)).toBe('●●●●●●●○○○')
  expect(food(85)).toBe('●●○○○○○○○○')
  expect(food(100)).toBe('○○○○○○○○○○')
})

test('/can thanks you and links ko-fi', async $ => {
  const ran = await $.command.run({
    command: 'can',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran.text).toContain('https://ko-fi.com/lofipuppy')
})

test('/bowl steps auto → always → off, or picks the one asked for', () => {
  expect(nextMode('auto', '')).toBe('always')
  expect(nextMode('always', '')).toBe('off')
  expect(nextMode('off', '')).toBe('auto')
  expect(nextMode('always', ' Off ')).toBe('off')
  expect(nextMode('off', 'bark')).toBe('auto')
})

test('the bowl shows by mode', () => {
  expect(isShown('auto', 30)).toBe(false)
  expect(isShown('auto', 50)).toBe(true)
  expect(isShown('always', 0)).toBe(true)
  expect(isShown('off', 95)).toBe(false)
})

test('/bowl off, then /bowl again, brings it back', async ($, on) => {
  mock.store(on)
  const run = (args: string) =>
    $.command.run({
      command: 'bowl',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
  expect((await run('off')).text).toContain('put away')
  expect((await run('')).text).toContain('half empty')
})
