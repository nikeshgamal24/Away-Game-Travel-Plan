---
name: add
description: Stage files for the next git commit, skipping anything that looks like a secret. Run only when the user types /add.
argument-hint: "[paths... | blank for all changes]"
disable-model-invocation: true
allowed-tools: Bash(git status:*), Bash(git add:*), Bash(git diff:*), Bash(git rev-parse:*), Bash(git check-ignore:*)
---

Stage changes for the next commit in this project.

Arguments: `$ARGUMENTS` (paths to stage; blank means all changes).

1. Run `git rev-parse --is-inside-work-tree`. If this isn't a git repo, stop and tell the user. Don't run `git init`
   unless they ask for it.
2. Run `git status --short` to see what changed.
3. Choose what to stage:
   - If paths were given, stage only those paths.
   - If nothing was given, stage every changed and untracked file.
4. **Never stage secrets or local-only files**, even if asked by name, and don't touch `.gitignore` to do it:
   `.env` (but `.env.example` is fine), `*.pem`, `*.key`, `credentials*.json`, `.claude/settings.local.json`,
   `approvals.json`, `data/schedule.imported.json`, and anything containing an API key. Stage the other files and
   list the skipped ones with the reason.
5. Stage with `git add -- <paths>`. Never use `git add -f`.
6. Show the result: `git status --short` and `git diff --cached --stat`.

Finish with one short line: how many files are staged, and which were skipped. Don't commit. That's `/commit`.
