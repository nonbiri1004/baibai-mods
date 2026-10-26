# puppy-mods

Small Claude Code mods kept by the lofi puppy, one folder per mod. This repo is **public**: no private paths, keys or brand docs here.

## Rules
- **Before drawing any pane, band or picture, read `STYLE.md`** and follow it. A new mod looks like `puppy-pipelines`.
- Never edit generated files by hand (`puppy-pipelines/hooks/puppy.ts`, `brand.lock.json`); change baibai-brand and sync.
- Each mod has tests in `<mod>/tests/`; run `claude plugin test <mod>` and `claude plugin validate <mod>` before a PR.
- Bump the mod's `version` in `.claude-plugin/plugin.json` when it changes.
- Never push to main; open a PR and let the user merge.
- Commit messages in English, starting with a verb. PR titles and descriptions in simple English. Reply to the user in Traditional Chinese.
- Codex reads this file as `AGENTS.md` (a symlink). Codex doesn't change this file or `STYLE.md`; suggest changes in the PR description instead.

## What the user runs, and how to try a change
- The user installs these mods from GitHub (`nonbiri1004/puppy-mods`, branch `main`). Claude Code keeps a copy in `~/.claude/plugins/cache/`, so the user runs only what was merged, at the `version` in `plugin.json`. A branch switch in this folder changes nothing they run.
- A change reaches the user only after its PR is merged **and** its `version` was bumped. Then they run `claude plugin marketplace update puppy-mods` and `claude plugin update <mod>@puppy-mods`, and restart.
- Work in a worktree (`git worktree add .claude/worktrees/<name> -b <name> origin/main`). Never switch branches in the main folder: other sessions and Codex use it.
- To try a change before it is merged: start `claude --plugin-dir .claude/worktrees/<name>/<mod>` in a terminal, or set `CLAUDE_CODE_PLUGIN_DIRS` to that folder's absolute path. That copy replaces the installed mod of the same name for that session only. Run `/reload-plugins` after each edit.
