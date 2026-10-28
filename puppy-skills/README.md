# puppy-skills

a quiet pane that lists the claude code skills you have, and where each one works.

type `/my-skills` (`/skills` is claude code's own). on the desktop the puppy sits at the top, typing at its little laptop; the terminal shows `•ᴥ•`. the pane only reads files: it never runs a skill and never shows what is running (that is `puppy-console`'s job).

```
•ᴥ• 4 skills · looked 10:02                     refresh
╭──────────────────────────────────────────────────────╮
│ personal                              anywhere · 2   │
│ ▸  nap Finds a sunny spot.                           │
│ ▸  walk-plan Plans the morning walk.                 │
╰──────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────╮
│ garden                         only in garden · 1    │
│ ▾  dig-hole Digs one hole.                    ⏰ 9:00 │
│      Digs one hole. Never two.                       │
│      ⏰ morning dig · 9:00 daily                      │
╰──────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────╮
│ toys                                     plugin · 1  │
│ ▸  ball Throws the ball.                             │
╰──────────────────────────────────────────────────────╯
```

(made-up skills, to show the shape.)

## where it looks

| card | read from | works in |
| --- | --- | --- |
| personal | `~/.claude/skills/**/SKILL.md` | every conversation |
| one per repo | `~/dev/**/.claude/skills/*/SKILL.md` (5 folders deep; skips `node_modules` and dot folders like `.claude/worktrees`) | only conversations opened in that repo |
| one per plugin | `<installPath>/skills/*/SKILL.md` for each plugin in `~/.claude/plugins/installed_plugins.json` | wherever the plugin is on |

each row is the skill's `name` and the first sentence of its `description`. press `▸` to see all of it.

## the clock

a skill gets `⏰` when a scheduled task's prompt (`~/.claude/scheduled-tasks/<task>/SKILL.md`) names it: its folder (`…/skills/<name>/`), `/<name>`, or a name with a dash in it as a whole word. a one-word name like `pdf` needs the folder or `/pdf`, since the word alone is too common.

the time comes from the desktop app's own `scheduled-tasks.json` files under `~/Library/Application Support/Claude/claude-code-sessions/` (macOS). a task the app turned off is left out. without those files the clock shows with no time.

it reads again when you open it and when you press refresh.
