# puppy-skills

a quiet pane that lists the claude code skills you have, and where each one works.

type `/my-skills` (`/skills` is claude code's own). on the desktop the puppy moves at the top, typing at its little laptop. in the terminal, it is a still puppy in block characters, 34 columns × 13 rows, above the header. it is left out when the pane is shorter than 26 rows or narrower than 34 columns. the pane only reads files: it never runs a skill and never shows what is running (that is `puppy-console`'s job).

```
4 skills · looked 10:02                     refresh
╭──────────────────────────────────────────────────────╮
│ yours                                 anywhere · 2   │
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
▸ from claude.ai 11
```

(made-up skills, to show the shape.)

## where it looks

| card | read from | works in |
| --- | --- | --- |
| yours | `~/.claude/skills/**/SKILL.md` | every conversation |
| one per repo | `~/dev/**/.claude/skills/*/SKILL.md` (5 folders deep; skips `node_modules` and dot folders like `.claude/worktrees`) | only conversations opened in that repo |
| from claude.ai (folded) | `~/.claude/skills/synced/…`: anthropic's skills the app copies from your claude.ai account, not ones you wrote | every conversation |
| one per plugin | `<installPath>/skills/*/SKILL.md` for each plugin in `~/.claude/plugins/installed_plugins.json` | wherever the plugin is on |

each row is the skill's `name` and the first sentence of its `description`. press `▸` to see all of it.

## the clock

a skill gets `⏰` when a scheduled task's prompt (`~/.claude/scheduled-tasks/<task>/SKILL.md`) names it: its folder (`…/skills/<name>/`), `/<name>`, or a name with a dash in it as a whole word. a one-word name like `pdf` needs the folder or `/pdf`, since the word alone is too common.

the time comes from the desktop app's own `scheduled-tasks.json` files under `~/Library/Application Support/Claude/claude-code-sessions/` (macOS). a task the app turned off is left out. without those files the clock shows with no time.

it reads again when you open it and when you press refresh.
