# AGENTS

This repo is the published `@mdgate/*` workspace.

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Writing rules

Writing rules, from Orwell, 1946. These govern prose: docs, PR text, messages. Never touch code or technical terms; swap in everyday words only where precision survives.

1. Never use a metaphor, simile or other figure of speech which you are used to seeing in print.
2. Never use a long word where a short one will do.
3. If it is possible to cut a word out, always cut it out.
4. Never use the passive where you can use the active.
5. Never use a foreign phrase, a scientific word or a jargon word if you can think of an everyday English equivalent.
6. Break any of these rules sooner than say anything outright barbarous.

Never use em dashes (`—`) anywhere: prose, docs, PR text, commits, comments, UI copy, code, or messages. Use commas, periods, colons, parentheses, or hyphens (`-`) instead.

Review every prose output against these rules before delivering.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Avoid comments; favor highly readable code instead - semantic variable names, no deep nesting. The code itself is the best comment.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Always ask before removing functionality or code that appears intentional.
- Never use the `uppercase` text-transform anywhere in the project (no Tailwind `uppercase` utility, no CSS `text-transform: uppercase`). Labels, eyebrows, and headers stay in sentence case.
- Do not preserve backward compatibility unless the user asks for it.

## Project facts

### Product domain

- **mdgate** (this monorepo): Pure TypeScript converters for 150+ file types, including DOCX, PDF, PPTX, XLSX, iWork, HWP, and email. Runs in Node, Edge, and browsers. Pass file bytes; get GitHub-Flavored Markdown.
- **Runtimes**: Node, Edge (Cloudflare Workers), and the browser. No native addons, no WASM, no Node builtins, no dependencies outside `@mdgate/*`.
- **Public API**: `@mdgate/converters` is the official bundle (`toMarkdown`, `create`, `all`). Each format is also its own package (`@mdgate/docx`, `@mdgate/pdf`, …) with the same `toMarkdown` function. Compose a custom set with `create()` from `@mdgate/core`.
- **Detection**: converters `sniff` bytes (and optional `hint.path`). Path is a sniff hint only, never read from disk. Needed for signature-less formats such as CSV.
- **Callbacks**: raster images, audio, and video need a registered callback (`image()`, `audio()`, `video()`). SVG converts locally. Those callbacks are not in `all()`.
- **Demo**: `apps/demo` (`@mdgate/demo`) at `convert.mdgate.dev`. Runs the library in a Web Worker. Files convert locally and never leave the machine.

### Engineering

- Package manager: **Bun** (`bun install`, `bun.lock`). Run workspace scripts with `bun run`. Workspace scope: `@mdgate/*`.
- Deploy target: **Cloudflare** only, for the demo. `account_id` is pinned in `apps/demo/wrangler.jsonc`. Push to `main` deploys via Workers Builds (see Deploy).
- Layout:
  - Format packages: `packages/<format>` (`@mdgate/docx`, `@mdgate/pdf`, …). Each implements `Converter` from `@mdgate/core`.
  - Shared packages: `packages/core` (contract, `create()`, `ConvertError`), `packages/document` (shared model + GFM serializer), `packages/containers` (ZIP/OPC, OLE, XML), `packages/office-common`, `packages/iwork-common`, `packages/utils`, `packages/ai`.
  - Bundle: `packages/converters` (`@mdgate/converters`).
  - Demo app: `apps/demo`. Keep app-specific UI there.
- Prefer the document model. A serializer fix in `@mdgate/document` applies to every converter on that path. Do not emit Markdown from a format package if `Document` can express the structure.
- Package tests import `../src`. Workspace tests under `test/` import `@mdgate/*` from `dist/`.

## Reference Docs

- Cloudflare: full docs are LLM-readable as markdown. Index: `https://developers.cloudflare.com/llms.txt`; append `.md` to any doc URL. Source of truth for Workers, routes, wrangler config.

## Commands

- Install: `bun install` from the repo root. That also sets `core.hooksPath` to `.githooks`.
- Pre-commit runs `bun run lint` then `bun test`. Fix failures before committing. The hook is a no-op when `CI` is set so release commits on the runner do not re-run the suite.
- After code changes (not docs-only): run `bun test` and `bun run lint` even if you skip the hook.
- Prefer a scoped Vitest path when iterating:
  ```bash
  bunx vitest run packages/html/test/html.test.ts
  bunx vitest run test/to-markdown.test.ts
  ```
- Workspace tests under `test/` (corpus, parity, portable, robustness) import `@mdgate/*` from `dist/`. If those fail after a source change, `bun run build` then re-run. Do not run `bun run build` otherwise, and never `bun run deploy:demo` / `bun run publish:all` / `bun run version --`, unless the user asks to publish. Patch publishes itself as the `publish` job after `check` on `main`. Minor and major go through the `release` job (see Releasing).
- If you create or modify a test file, run it and iterate until it passes.
- If a converter output change is intentional, update the matching snapshot under `test/snapshots`. Do not weaken assertions to make a test pass.
- Fixture-corpus parity: `bun run test:parity`.
- Local:
  ```bash
  bun run dev:demo        # demo SPA → Vite default port
  ```
- For ad-hoc scripts, write them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

## Dependency and Install Security

Lightweight rules (no supply-chain age gate, no lockfile commit hooks, no forced exact pins yet):

- Published `@mdgate/*` packages depend only on other `@mdgate/*` packages. Do not add a third-party runtime dependency to a published package. Root and `@mdgate/demo` may take tools and app deps.
- Treat dependency and `bun.lock` changes as reviewed code. Explain why a dep was added or bumped in the PR.
- Prefer stable, well-known packages. Avoid drive-by upgrades unrelated to the task.
- Hydrate with `bun install`. For CI-style installs use `bun install --frozen-lockfile`.
- Do not commit secrets, `.dev.vars`, or generated `worker-configuration.d.ts`.
- If you only need types or a small helper, prefer an existing workspace package before adding a new root dependency.

## Releasing

Agents ship this repo. Do not hand-edit `version` or `@mdgate/*` pins. Ordinary commits do not touch versions. Git holds the last published `x.y.z`. There is one npm line: `latest`. No beta.

All published `@mdgate/*` packages share one version. `@mdgate/converters@0.4.1` means every package is `0.4.1`. Internal `@mdgate/*` pins are that same number. Private packages (workspace root, `@mdgate/demo`) stay on `workspace:*` and are not published. Never mix versions in a compose install.

| Change | During 0.x | After 1.0 | Who publishes |
| --- | --- | --- | --- |
| Bugfix. Public TypeScript API unchanged. Converted Markdown may change. | patch | patch | CI, after green `main` |
| New format, new published package, or new public API | minor | minor | Human, CI `release` |
| Breaking public API or `Converter` contract | minor | major | Human, CI `release` |
| First API freeze | `1.0.0` | - | Human, CI `release` |

A mixed release takes the highest row. Do not infer minor vs major from commit messages. Ask if that increment is unclear.

A new published package is born at the version that introduces it; adding one is a minor. Add `packages/<name>` with public `@mdgate/<name>`. `pack:check` and `publish:all` discover it from `packages/*/package.json`. Still wire it into the layered `build` script, and into `@mdgate/converters` if it is a format.

Do not unpublish. Do not reuse a version. Pre-`0.4.0` versions are the old independent line; they stay on npm.

### What agents do

- Fix a converter, change output, land the PR on `main`. After `check` is green, the `publish` job bumps patch, commits `release: x.y.z`, tags, publishes, and writes a GitHub Release from commits since the previous tag. Do not bump in the PR.
- Add a format, add a published package, or change the public API. Label the PR `release:minor` (or `release:major`). After merge, run `gh workflow run ci.yml -f increment=minor` from `main`. Auto-patch will not fire.
- A new `packages/<name>/package.json` that is public also blocks auto-patch, even if the label is missing. Then run CI with `minor`.
- Docs, AGENTS, CI, or demo only: no publish.
- Put `[skip publish]` in the commit message to skip auto-patch for a `packages/` change that must not ship yet.

Repo secret `NPM_TOKEN` is an npm Automation token with publish rights on `@mdgate/*`. Put it in GitHub Actions secrets, never in the repo. If branch protection blocks the bot, allow `github-actions[bot]` to push `main`.

### Workflows

One workflow, `ci.yml`. Three jobs, in order. `publish` and `release` are mutually exclusive.

| Job | Trigger | What it does |
| --- | --- | --- |
| `check` | PR, push to `main`, and `workflow_dispatch` | `lint`, `build`, `test`, `pack:check`. Skips `release:` commits on push. |
| `publish` | push to `main`, after `check` | Patch bump + publish + GitHub Release, unless skipped (see above). |
| `release` | `workflow_dispatch` on `main`, after `check` | `minor` / `major` (or a forced `patch`). Bump, commit, tag, publish, GitHub Release. |

```bash
gh workflow run ci.yml -f increment=minor
gh workflow run ci.yml -f increment=major
```

If publish dies halfway, re-run the same workflow. Do not bump again. Already-published packages are skipped. Agents still do not push to `main` themselves; only these jobs do, and only for `release: x.y.z`.

### Local fallback

Use only when CI cannot (missing secret, registry outage, explicit user request):

```bash
bun test
bun run lint
bun run pack:check
bun run version -- patch                    # or minor / major
git commit -am "release: 0.4.2"
git tag v0.4.2
bun run publish:all
bun scripts/github-release.ts
```

`bun run version -- 0.5.0` realigns a drifted tree to an exact `x.y.z`. `version:check` rejects anything that is not a shared exact `x.y.z`.

One bump moves every published package. Never bump a subset. If nothing user-visible ships, do not bump. Do not leave a new number unpublished. Do not publish without bumping.

## Git

Multiple agent sessions may be running in this cwd at the same time, each modifying different files. Git operations that touch unstaged, staged, or untracked files outside your own changes will stomp on other sessions' work. Follow these rules:

Worktree and PR Workflow:

- Cloud Agent: ignore worktree. Branch in the VM checkout; isolation is the pod itself.
- All modifications must be performed in a new dedicated git worktree on a fresh branch (local agents only).
- The PR must be a real remote GitHub Pull Request (push the worktree branch to origin, then create via `gh pr create` or GitHub UI). Local merges or local-only branches do not count as submission.
- Direct commits or pushes to `main` are not allowed for modifications.
- Merge PRs with squash (`gh pr merge --squash`). Do not use merge commits.
- After the remote PR is squash-merged on GitHub, delete the worktree and the branch.
- After squash-merging a PR, always update the local main branch and check main for any legacy diff remnants.

Committing:

- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- Message format: `{feat,fix,docs,chore,test}[(core,document,docx,pdf,demo,...)]: <commit message>` (optionally multiple lines). Use the package or app directory as the scope. Message is informative and concise.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Issues and PRs

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When creating issues:

- Add labels for the affected surface when useful (`pkg:docx`, `pkg:pdf`, `demo`, `docs`).

When posting issue/PR comments:

- Write the comment to a temp file and post with `gh issue/pr comment --body-file` (never multi-line markdown via `--body`).
- Keep comments concise, technical, in the user's tone.
- End every AI-posted comment with the AI-generated disclaimer line specified by the originating prompt when one is given.

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the message so merging auto-closes the issue. For multiple issues, repeat the keyword per issue (`closes #1, closes #2`); a shared keyword (`closes #1, #2`) only closes the first.

## Deploy

- Repo: `github.com/mdgate/converters`.
- Cloudflare account id: `b1a1e79c50cbd7f8b2cfb5b74c5d76db` (pinned in `apps/demo/wrangler.jsonc`).
- Production Worker: `mdgate-demo` → `https://convert.mdgate.dev`.
- Auto-deploy: Workers Builds is connected to this GitHub repo. A push to `main` builds packages, then runs `bun run deploy:demo`. Settings live on the Worker (Settings > Builds), not in git:
  - Root: `/`
  - Build: `bun run build`
  - Deploy: `bun run deploy:demo`
  - `BUN_VERSION=1.3.4`
- Do not run manual deploy unless the user asks. Prefer waiting for Workers Builds, or:
  ```bash
  bun run deploy:demo       # vite build && wrangler deploy
  ```
- Runtime secrets live in Workers Secrets / `.dev.vars` only - never in source or wrangler non-secret config.

## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.

## Cursor Cloud specific instructions

The startup update script already ran `bun install`, so dependencies are hydrated when you start.

- Toolchain: Bun `1.3.4` lives at `~/.bun/bin/bun`. It is on `PATH` in login shells only. A plain non-login `bash -c` will not find `bun`, so scripted calls should use a login shell or the full path. Node 22 is present but the project runs on Bun.
- Demo app: `bun run dev:demo` serves the SPA on port `5173`. The converter runs in a Web Worker; the "Try a sample" buttons (letter.docx, sheet.xlsx, page.html, note.eml, notes.rtf, report.csv) convert without any file upload, so they are the quickest way to smoke-test end to end.
- Workspace tests under `test/` import `@mdgate/*` from `dist/`. Run `bun run build` once before `bun test` after a fresh checkout, and rebuild after changing package source (see Commands). Package tests import `../src` and need no build.
- Standard lint/test/build/run commands are in Commands above; do not duplicate them here.
