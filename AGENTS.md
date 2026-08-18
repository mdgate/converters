# AGENTS

This repo is the published `@mdgate/*` workspace.

## Versioning

All published `@mdgate/*` packages share one version. `@mdgate/converters@0.4.1` means every package is `0.4.1`. Internal `@mdgate/*` dependencies are exact pins of that same number. Private packages (workspace root, `@mdgate/demo`) are not published and stay on `workspace:*`.

Semver is decided at the product level, not per package. If only `@mdgate/pdf` changed, everything still moves together. Never mix versions in a compose install.

| Change | During 0.x | After 1.0 |
| --- | --- | --- |
| Bugfix. Public TypeScript API unchanged. Converted Markdown may change. | patch | patch |
| New format, new published package, or new public API | minor | minor |
| Breaking public API or `Converter` contract | minor | major |
| First API freeze | `1.0.0` | — |

A release that mixes kinds takes the highest row that applies.

A new published package is born at the version of the release that introduces it. Adding one is a minor. Wire it into the `build`, `pack:check`, and `publish:all` scripts, and into `@mdgate/converters` if it is a format.

Do not unpublish. Do not reuse a version number. Pre-`0.4.0` versions are the old independent line; they stay on npm.

## Bump

Bump only when shipping to npm. Ordinary commits do not touch versions. The number in git is the last published number until the next release.

Never edit `version` or `@mdgate/*` pins by hand:

```bash
bun run version -- patch        # 0.4.0 → 0.4.1
bun run version -- minor        # 0.4.0 → 0.5.0
bun run version -- major        # 0.4.0 → 1.0.0
bun run version -- 0.5.0        # explicit; only to realign a drifted tree
bun run version:check
```

`version` writes the same number onto every published `package.json` and every internal `@mdgate/*` pin. `workspace:*` is left alone.

Rules:

- One bump moves every published package. Never bump a subset.
- Pick the increment from the table above. If nothing user-visible ships, do not bump.
- Current version already on npm → bump first, then publish. Do not republish the same number.
- Bump and `publish:all` are one release. Do not leave a new number sitting unpublished, and do not publish without bumping.
- If `publish:all` dies halfway, retry the remaining packages at the **same** version. Do not bump again.
- `publish:all` refuses to run if versions have drifted. Always publish the full set.

Release:

```bash
bun test
bun run version:check
bun run version -- patch        # or minor / major
git commit -am "release: 0.4.1"
git tag v0.4.1
bun run publish:all
```
