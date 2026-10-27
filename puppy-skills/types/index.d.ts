// where a skill can be used: personal ones everywhere, a repo's only in a conversation opened in
// that repo, a plugin's wherever the plugin is turned on
export type Where = 'personal' | 'repo' | 'plugin'

// one scheduled task whose prompt names the skill
export type Use = {
  // the task's name in the app, e.g. "draw the puppy every day"
  task: string
  // short time words, e.g. "9:00 daily"; empty when the app's schedule file was not found
  when: string
}

export type Skill = {
  // <where>:<group>:<name>, unique in the list
  id: string
  name: string
  description: string
  where: Where
  // the repo or the plugin it comes from; empty for personal
  group: string
  // the folder holding SKILL.md, matched against what a schedule's prompt names
  dir: string
  uses: Use[]
}

export type View = {
  skills: Skill[]
  // the ids unfolded to their whole description
  openIds: string[]
  // ms since the epoch of the last look; null before the first
  at: number | null
  // what could not be read
  notes: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'puppy-skills': { view: View }
  }
}
