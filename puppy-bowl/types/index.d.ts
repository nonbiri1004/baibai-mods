// what the bowl remembers for this session
export type Bowl = {
  // context used, 0–100; null before the first reading
  used: number | null
}

// auto: out once half the bowl is eaten; always: out the whole time; off: put away
export type Mode = 'auto' | 'always' | 'off'

declare module 'claude-code' {
  interface PluginState {
    // mode: copied from $.store at session start so the drawing can read it
    'puppy-bowl': { bowl: Bowl; mode: Mode }
  }
}
