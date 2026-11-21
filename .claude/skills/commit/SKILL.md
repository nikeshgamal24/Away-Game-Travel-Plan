---
name: commit
description: Commit the staged changes with a message for the given feature. Run only when the user types /commit.
argument-hint: "<feature, e.g. 8 stage A>"
disable-model-invocation: true
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git commit:*), Bash(git rev-parse:*), Bash(git branch:*), Read, Grep, Glob
---

Commit the **already staged** changes for this feature: `$ARGUMENTS`

1. If no feature was given, stop and ask for one (for example `/commit 8 stage A`).
2. Run `git diff --cached --stat`. If nothing is staged, stop and say: "Nothing is staged. Run /add first."
   Don't stage anything yourself.
3. Read the staged diff (`git diff --cached`) so the message describes the real changes.
4. Find the feature's title: if the argument starts with a number N, read `specs/0N-*.md` (for example `8` →
   `specs/08-*.md`) and take the title from its first `# Feature N: ...` line. Any extra words (such as "stage A")
   go after the title.
5. Write the message in this shape:

   ```
   Feature <N>: <title from the spec>[ (<extra words>)]

   - <one plain bullet per meaningful change, from the diff>
   - Tests: <count passing, if you ran them in this session; otherwise leave this line out>

   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   ```

   - Keep the first line under 72 characters. If the argument isn't a number, use it as the first line as-is.
   - Don't claim anything the diff doesn't show.
6. Commit on the current branch with a heredoc: `git commit -F - <<'MSG' ... MSG`. Never use `--amend`,
   `--no-verify` or `-a`.
7. If a hook fails, show its output, fix nothing on your own, and stop.
8. Show `git log --oneline -1`.

Don't push. That's `/push`.
