---
name: push
description: Push the current branch to its remote. Run only when the user types /push.
argument-hint: "[remote, default origin]"
disable-model-invocation: true
allowed-tools: Bash(git status:*), Bash(git branch:*), Bash(git remote:*), Bash(git log:*), Bash(git push:*), Bash(git rev-parse:*)
---

Push the current branch. The remote is `$ARGUMENTS`, or `origin` if that's blank.

1. Run `git rev-parse --abbrev-ref HEAD` to get the branch. If HEAD is detached, stop and say so.
2. Run `git remote -v`. If the remote doesn't exist, stop and tell the user how to add one
   (`git remote add origin <url>`). Don't add it yourself.
3. Run `git status --short`. If there are uncommitted changes, mention them in one line. They won't be pushed.
4. Show what will go up: `git log --oneline @{u}..HEAD` if the branch has an upstream, otherwise
   `git log --oneline -10`.
5. Push:
   - If the branch has an upstream: `git push <remote> <branch>`.
   - If it doesn't: `git push -u <remote> <branch>`.
   - **Never** use `--force`, `--force-with-lease` or `--delete`, and never push to a branch other than the current one.
6. If the push is rejected (for example, the remote has newer commits), show the error and stop. Suggest
   `git pull --rebase`, but don't run it.

Finish with one line: branch, remote, and how many commits were pushed.
