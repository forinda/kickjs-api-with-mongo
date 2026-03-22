# KickJS Framework Filed Issues

Bug tracker for issues discovered while building Vibed with KickJS v1.2.2.
Each issue file maps to the GitHub issue templates at [kick-js/.github/ISSUE_TEMPLATE/](https://github.com/forinda/kick-js/tree/main/.github/ISSUE_TEMPLATE).

## Issue Index

### Bug Reports (`[Bug]:`)

| ID | Title | Package | Severity | Status | Fixed In |
|---|---|---|---|---|---|
| [KICK-001](./KICK-001.md) | `kick new` interactive prompt not scriptable | cli | Low | Open | — |
| [KICK-002](./KICK-002.md) | Nodemailer peer dependency mismatch | mailer | Low | Open | — |
| [KICK-003](./KICK-003.md) | Modules without routes crash Express | http | High | Released | v1.2.3 |
| [KICK-004](./KICK-004.md) | `loadEnv()` returns loosely typed object | config | Medium | Released | v1.2.3 |
| [KICK-005](./KICK-005.md) | QueueAdapter `queues` expects strings, docs show classes | queue | Medium | Open | — |
| [KICK-006](./KICK-006.md) | Mongoose `OverwriteModelError` during HMR | http | High | Open | — |
| [KICK-007](./KICK-007.md) | Route path doubling: module path + controller path | http | High | Open | — |
| [KICK-008](./KICK-008.md) | Global middleware receives Express handler, not RequestContext | http | Medium | Open | — |
| [KICK-009](./KICK-009.md) | `ctx.set()`/`ctx.get()` not shared between middleware and handler | http | Critical | Released | v1.2.5 |
| [KICK-010](./KICK-010.md) | `@Public()` not respected — AuthAdapter resolveHandler fails | auth | Critical | Released | v1.2.3 |
| [KICK-011](./KICK-011.md) | `@Inject(TOKEN)` doesn't work as property decorator | core | Medium | Open | — |
| [KICK-012](./KICK-012.md) | DevToolsAdapter `peerAdapters` lost on HMR rebuild | devtools | Low | Open | — |
| [KICK-013](./KICK-013.md) | `@Job`/`@Service` classes lose DI binding on HMR | queue | Low | Released | v1.2.6 |
| [KICK-016](./KICK-016.md) | `@Service()` + `@Job()` classes not auto-registered in DI | queue, core | High | Released | v1.2.6 |

### Documentation Issues (`[Docs]:`)

| ID | Title | Type | Status | Fixed In |
|---|---|---|---|---|
| [KICK-014](./KICK-014.md) | `ApiQueryParamsConfig` type name mismatch in docs | Incorrect content | Open | — |

### Feature Requests (`[Feature]:`)

| ID | Title | Package | Type | Status |
|---|---|---|---|---|
| [KICK-015](./KICK-015.md) | `kick readme` CLI command | cli | New CLI command | Open |
| [KICK-017](./KICK-017.md) | `@Service()` classes should be auto-registered in DI container | core, queue | Enhancement | Released |
| [KICK-018](./KICK-018.md) | Type-safe API client generation (tRPC-like) | cli, http, swagger | New feature | Open |

## Statuses
- **Open** — Issue filed, not yet fixed in framework
- **Confirmed** — Maintainer acknowledged
- **In Progress** — Fix being worked on
- **Fixed** — Fix merged, awaiting release
- **Released** — Fix available in a published version
- **Won't Fix** — Intentional behavior or out of scope

## How to File on GitHub

Each issue type maps to a GitHub issue template:

| Type | Template | Title prefix | Labels |
|---|---|---|---|
| Bug | `bug_report.yml` | `[Bug]:` | `bug` |
| Docs | `documentation.yml` | `[Docs]:` | `documentation` |
| Feature | `feature_request.yml` | `[Feature]:` | `enhancement` |

### Filing a bug
1. Go to https://github.com/forinda/kick-js/issues/new?template=bug_report.yml
2. Fill in: KickJS Version, Affected Package, Description, Steps to Reproduce, Expected/Actual Behavior, Environment
3. Copy content from the corresponding `KICK-NNN.md` file
4. Update this README with the GitHub issue link

### Filing a docs issue
1. Go to https://github.com/forinda/kick-js/issues/new?template=documentation.yml
2. Fill in: Type (Incorrect/Missing/Typo/etc), Page URL, Description

### Filing a feature request
1. Go to https://github.com/forinda/kick-js/issues/new?template=feature_request.yml
2. Fill in: Related Package, Feature Type, Problem, Proposed Solution, Alternatives

## Tracking Resolution

When an issue is fixed upstream, update:
1. The `KICK-NNN.md` file — set Status to `Fixed`/`Released`, add `Fixed In` version
2. This README index table
3. `framework-issues.md` — update the corresponding section with the fix
4. Articles — update any referenced workarounds that are no longer needed
