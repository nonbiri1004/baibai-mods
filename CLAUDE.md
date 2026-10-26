# puppy-mods

Small Claude Code mods kept by the lofi puppy, one folder per mod. This repo is **public**: no private paths, keys or brand docs here.

## Rules
- **Before drawing any pane, band or picture, read `STYLE.md`** and follow it. A new mod looks like `puppy-console`.
- Never edit generated files by hand (`puppy-console/hooks/puppy.ts`, `brand.lock.json`); change baibai-brand and sync.
- Each mod has tests in `<mod>/tests/`; run `claude plugin test <mod>` and `claude plugin validate <mod>` before a PR.
- Bump the mod's `version` in `.claude-plugin/plugin.json` when it changes.
- Never push to main; open a PR and let the user merge.
- Commit messages in English, starting with a verb. PR titles and descriptions in simple English. Reply to the user in Traditional Chinese.
- Codex reads this file as `AGENTS.md` (a symlink). Codex doesn't change this file or `STYLE.md`; suggest changes in the PR description instead.
