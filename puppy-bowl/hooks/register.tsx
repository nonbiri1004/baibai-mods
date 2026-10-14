import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Bowl, Mode } from '../types'

// the puppy's orange (--phones in shared/theme.css): the one accent, on the headphones
const PHONES = '#e07b35'
const CELLS = 10
// the puppy only comes out once half the bowl is eaten (the status line already has the number)
const SHOW = 50
// past this much context used, the puppy mentions /compact
const HUNGRY = 80
const KOFI = 'https://ko-fi.com/lofipuppy'

const bowl = atom({ plugin: 'puppy-bowl', key: 'bowl' } as const, { used: null } as Bowl)
const mode = atom({ plugin: 'puppy-bowl', key: 'mode' } as const, 'auto' as Mode)

// /bowl steps through the modes in this order; /bowl auto|always|off picks one
const MODES: readonly Mode[] = ['auto', 'always', 'off']
const SAID: Record<Mode, string> = {
  auto: 'the bowl comes out when it is half empty.',
  always: 'the bowl stays out.',
  off: 'the bowl is put away. /bowl brings it back.',
}

export function nextMode(was: Mode, arg: string): Mode {
  const asked = arg.trim().toLowerCase()
  if ((MODES as readonly string[]).includes(asked)) {
    return asked as Mode
  }

  return MODES[(MODES.indexOf(was) + 1) % MODES.length] ?? 'auto'
}

export function isShown(m: Mode, used: number): boolean {
  return m === 'always' || (m === 'auto' && used >= SHOW)
}

// food left in the bowl: ●●●●●●○○○○
export function food(used: number): string {
  const left = Math.round(((100 - used) / 100) * CELLS)
  const full = Math.max(0, Math.min(CELLS, left))
  return '●'.repeat(full) + '○'.repeat(CELLS - full)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'can',
      description: 'give the puppy a can (opens ko-fi)',
    })
    await $.command.register({
      name: 'bowl',
      description: 'the puppy bowl: auto (out when half empty) → always → off',
      argumentHint: '[auto|always|off]',
    })
    // the mode is kept in $.store, so every new conversation remembers it
    const kept = (await $.store.get('mode')) as Mode | undefined
    if (kept && MODES.includes(kept)) {
      await update($, mode, () => kept)
    }
    const { context } = await $.session.usage()
    await update($, bowl, () => ({ used: context.percent ?? null }))

    return next(e)
  })

  // the engine pushes new figures after each turn; the write redraws the band
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      await update($, bowl, () => ({ used: e.context.percent ?? null }))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // before the first reply there's no reading yet: the bowl starts full
    const used = (await read($, bowl)).used ?? 0
    if (e.props.hasSurvey || !isShown(await read($, mode), used)) {
      return next(e)
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const isHungry = used >= HUNGRY

    return (
      <Box>
        <Text>
          <Text color={PHONES}>◖</Text>
          <Text dimColor>•ᴥ•</Text>
          <Text color={PHONES}>◗</Text>
          <Text dimColor>
            {' '}
            {food(used)} {100 - used}% left
            {isHungry ? ' · the bowl is almost empty ' : ''}
          </Text>
        </Text>
        {isHungry && !e.props.isWorking && (
          <Button key="compact" label="compact" onPress={() => $.session.compact()} />
        )}
      </Box>
    )
  })

  on('command.run', { command: 'bowl' }, async ($, e) => {
    const now = await update($, mode, was => nextMode(was, e.args))
    await $.store.set('mode', now)

    return { text: SAID[now] }
  })

  on('command.run', { command: 'can' }, () => ({
    text: `the puppy wags its tail. thank you for the can ♡ ${KOFI}`,
  }))

  // draws /can's row with a real link instead of plain text
  on('ui.render', { component: 'CommandOutput', props: { command: 'can' } }, ($, e) => {
    const { Text, Link } = $.ui.resolve(e)

    return (
      <Text dimColor>
        the puppy wags its tail. thank you for the can ♡ <Link href={KOFI} label="ko-fi.com/lofipuppy" />
      </Text>
    )
  })
}
