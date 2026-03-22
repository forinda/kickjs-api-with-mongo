---
title: "Filing KickJS Framework Issues as You Build — A Living Bug Tracker That Improves Your Tools"
published: false
description: "How maintaining a structured issue tracker alongside a real project turned framework bugs into framework fixes. A practical guide to the feedback loop between app developers and framework authors."
tags: kickjs, mongodb, typescript, nodejs, opensource
series: "Building with KickJS"
cover_image: ""
---

## TL;DR

- We created `framework-filed-issues/` inside our project to track every KickJS bug and quirk we hit while building Vibed
- Each issue follows a consistent template: Status, Severity, Found in, Fixed in, Description, Steps to Reproduce, Workaround, Suggested Fix
- Filing detailed issues with reproduction steps and suggested fixes led to actual framework releases (v1.2.3, v1.2.5, v1.2.6, v1.2.7)
- The feedback loop — discover, workaround, file, fix, validate, update docs — is the most effective way to improve the tools you depend on
- Tips for working with small/personal framework maintainers without burning them out

---

## Why Track Framework Issues Inside Your Project?

When I started building Vibed — a Jira-like task management backend — with KickJS v1.2.2, I knew I was adopting a young framework. The docs were good enough to get started, but any non-trivial project was going to surface edge cases the framework author hadn't hit yet.

The question was: what do I do when I hit those edges?

Option one: complain on Twitter. Option two: switch frameworks. Option three: document every issue systematically, build workarounds, and file them upstream so they get fixed.

I went with option three, and it changed the trajectory of both my project and the framework itself.

The first thing I did was create a `framework-filed-issues/` directory right in the project root. Not a separate repo. Not a Notion doc. Not a GitHub issue dump. A structured directory of markdown files, living alongside the code that surfaced the bugs.

```
vibed/
├── src/
├── framework-issues.md           # Quick reference of known issues
├── framework-filed-issues/
│   ├── README.md                 # Issue index with status table
│   ├── KICK-001.md
│   ├── KICK-002.md
│   ├── ...
│   └── KICK-018.md
└── articles/
```

Why inside the project? Because the issues are discovered in context. The reproduction steps reference real code. The workarounds are applied in real files. When an issue gets fixed upstream, I need to update both the workaround code and the issue file. Keeping them together means nothing falls through the cracks.

---

## The Issue Template

Every issue file follows a consistent structure. I modeled it after the KickJS GitHub issue templates (`bug_report.yml`, `feature_request.yml`, `documentation.yml`) so that when I'm ready to file upstream, I can copy-paste with minimal reformatting.

Here's the template:

```markdown
# KICK-NNN: Short descriptive title

- **Status**: Open | Confirmed | In Progress | Fixed | Released | Won't Fix
- **Severity**: Critical | High | Medium | Low
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: http | core | queue | auth | mailer | cli

## Description
What's broken, in 2-3 sentences.

## Steps to Reproduce
1. Numbered steps
2. That anyone can follow
3. To trigger the bug

## Expected Behavior
What should happen.

## Actual Behavior
What actually happens, including error messages.

## Error / Stack Trace
```
Paste the actual error output here
```

## Environment
- Node.js version
- OS
- Package manager

## Workaround
What I'm doing right now to get past this.

## Suggested Fix
How I think the framework should fix it, with code if possible.
```

The `Status` field is the most important one. It tracks the issue through its lifecycle:

| Status | Meaning |
|--------|---------|
| **Open** | Filed locally, not yet submitted upstream |
| **Confirmed** | Framework maintainer acknowledged |
| **In Progress** | Fix being worked on |
| **Fixed** | Fix merged, awaiting release |
| **Released** | Fix available in a published version |
| **Won't Fix** | Intentional behavior or out of scope |

And the README.md file serves as an index table that gives me a bird's-eye view of all issues at a glance:

```markdown
| ID | Title | Package | Severity | Status | Fixed In |
|---|---|---|---|---|---|
| KICK-001 | `kick new` interactive prompt not scriptable | cli | Low | Open | — |
| KICK-003 | Modules without routes crash Express | http | High | Released | v1.2.3 |
| KICK-009 | `ctx.set()`/`ctx.get()` not shared | http | Critical | Released | v1.2.5 |
| KICK-016 | `@Service()` + `@Job()` not auto-registered | queue, core | High | Released | v1.2.6 |
```

---

## Real Example: KICK-009 — The Critical Context Bug

This is the issue that cost me the most hours and ultimately drove the most impactful framework fix.

I was building the auth middleware for Vibed. The pattern was simple: middleware validates the JWT, stores the user in context, handler reads the user from context. Every framework works this way.

```typescript
// Middleware: validate JWT and store user
export const authBridgeMiddleware: MiddlewareHandler = (ctx, next) => {
  const token = ctx.headers.authorization?.split(' ')[1];
  const payload = jwt.verify(token, env.JWT_SECRET);
  ctx.set('user', { id: payload.sub, email: payload.email });
  next();
};

// Handler: read user from context
async create(ctx: RequestContext) {
  const user = ctx.get<AuthUser>('user'); // undefined!
  // TypeError: Cannot read properties of undefined (reading 'id')
}
```

`ctx.get('user')` returned `undefined`. Every single time. The middleware was running — I could verify that with console logs — but the handler couldn't see what the middleware had set.

After digging into the KickJS source, I found the root cause: `router-builder.ts` created a **new** `RequestContext` instance for each middleware and each handler. Every instance had its own private `metadata` Map. `ctx.set()` in middleware wrote to Map A. `ctx.get()` in the handler read from Map B. They were completely isolated.

Here's what I filed in KICK-009:

```markdown
# KICK-009: `ctx.set()`/`ctx.get()` not shared between middleware and handler

- **Status**: Released
- **Severity**: Critical
- **Found in**: v1.2.2
- **Fixed in**: v1.2.5
- **Component**: http

## Description
In `router-builder.ts`, each middleware and handler receive separate
`new RequestContext(req, res, next)` instances. The `metadata` property
is a private `new Map()` per instance. `ctx.set('user', user)` in
middleware is invisible to `ctx.get('user')` in the handler.

## Suggested Fix
Attach the metadata Map to `req` on first creation, then reuse it:

function getOrCreateContext(req, res, next) {
  if (!req.__ctx) {
    req.__ctx = new RequestContext(req, res, next);
  }
  return req.__ctx;
}
```

The workaround I used in Vibed while waiting for the fix was to mutate `req` directly:

```typescript
// Workaround: store on req, read with a helper
export const authBridgeMiddleware: MiddlewareHandler = (ctx, next) => {
  const user = (ctx.req as any).user; // Set by AuthAdapter
  if (user) {
    ctx.set('user', user);
  }
  next();
};

// Helper that abstracts the workaround
export function getUser(ctx: RequestContext): AuthUser {
  const user = ctx.get<AuthUser>('user');
  if (!user) throw HttpException.unauthorized('Authentication required');
  return user;
}
```

By wrapping the workaround in `getUser()`, every controller called one function. When v1.2.5 fixed the underlying issue, I updated the middleware and the helper — zero changes needed in 14 controllers.

---

## Real Example: KICK-016 — DI Auto-Registration

This one hit when I was adding BullMQ job processors. The pattern should have been straightforward:

```typescript
@Service()
@Job('email')
export class EmailProcessor {
  @Autowired(MAILER) private mailer!: MailerService;

  @Process('send-welcome-email')
  async sendWelcome(job: BullMQJob<{ email: string; firstName: string }>) {
    await this.mailer.send({
      to: job.data.email,
      subject: `Welcome to Vibed, ${job.data.firstName}!`,
      html: `<h1>Welcome!</h1>`,
    });
  }
}
```

But when the app started, I got:

```
Error: No binding found for: EmailProcessor
    at Container.resolve (container.ts:105:13)
    at QueueAdapter.beforeStart (queue.adapter.ts:75:35)
```

The `@Service()` decorator only set metadata. It did not call `container.register()`. So when `QueueAdapter.beforeStart()` tried to resolve the processor class, the container had no idea it existed.

My workaround was a `ProcessorRegistrarAdapter` that manually registered processor classes before the `QueueAdapter`:

```typescript
export class ProcessorRegistrarAdapter implements AppAdapter {
  name = 'ProcessorRegistrarAdapter';

  beforeStart(_app: any, container: Container) {
    if (!container.has(EmailProcessor)) {
      container.register(EmailProcessor, EmailProcessor);
    }
  }
}

// In adapters array — MUST come before queueAdapter
export const adapters = [
  new ProcessorRegistrarAdapter(),
  queueAdapter,
  // ...
];
```

In my issue file, I suggested two fix options. The framework implemented Option B first in v1.2.6 — `QueueAdapter.beforeStart()` auto-registers `@Job` classes before resolving them. Then v1.2.7 implemented the more general fix: `Container.bootstrap()` now auto-registers all `@Service()`-decorated classes.

---

## Real Example: KICK-017 — Feature Request

Not every issue is a bug. KICK-017 was a feature request born from the KICK-016 workaround. After filing the bug, I realized the real problem was deeper: `@Service()` should mean "this class is resolvable from the container" without any manual registration step.

```markdown
# KICK-017: `@Service()` classes should be auto-registered in DI container

- **Status**: Released
- **Type**: Feature Request
- **Fixed in**: v1.2.6 (QueueAdapter), v1.2.7 (Container auto-registration)

## Problem
The `@Service()` decorator only sets metadata — it does not register
the class in the DI container. Any code that calls
`container.resolve(ServiceClass)` fails unless the consumer manually
calls `container.register()`.
```

The distinction between bug reports and feature requests matters. Bugs say "this is broken." Feature requests say "this could be better." Framework maintainers prioritize differently based on the category. A critical bug blocking adoption gets immediate attention. A feature request goes into the backlog. Filing them correctly respects the maintainer's time.

---

## The Feedback Loop

Over the course of building Vibed, a clear pattern emerged:

```
Discover → Workaround → File → Fix → Validate → Update Docs
```

**Discover**: Hit a bug during development. The error message is usually cryptic. Spend time understanding the root cause by reading the framework source.

**Workaround**: Build a workaround that unblocks development. Keep the workaround isolated (in a helper function, in a custom adapter) so it's easy to remove later.

**File**: Write the issue in `framework-filed-issues/` using the template. Include the root cause, reproduction steps, and a suggested fix. The suggested fix is the most valuable part — it tells the maintainer exactly what to change.

**Fix**: The framework author publishes a new version with the fix.

**Validate**: Update the project to the new version. Verify the fix actually solves the issue. Remove the workaround code.

**Update Docs**: Update the issue file status to "Released." Update `framework-issues.md` with the resolution. Update any articles or documentation that referenced the workaround.

Here's the timeline for Vibed's issues:

| Version | Issues Fixed | What Changed |
|---------|-------------|--------------|
| v1.2.3 | KICK-003, KICK-004, KICK-010 | Modules without routes, env typing, `@Public()` resolution |
| v1.2.5 | KICK-009 | Shared `RequestContext` metadata across middleware/handler |
| v1.2.6 | KICK-013, KICK-016 | Queue processor DI auto-registration, HMR DI rebinding |
| v1.2.7 | KICK-017 | `Container.bootstrap()` auto-registers all `@Service()` classes |

Four releases. Seven issues fixed. All because structured bug reports with suggested fixes made the maintainer's job easier.

---

## Tips for Working with Small Framework Maintainers

KickJS is maintained by a solo developer. Most of the Node.js ecosystem runs on projects maintained by one or two people. Here's what I've learned about filing issues productively:

### 1. Do Your Homework First

Before filing, read the framework source. Understand whether it's actually a bug or a misunderstanding. Half the issues I initially thought were bugs turned out to be undocumented behavior. I still filed them — as documentation issues — but knowing the difference saved back-and-forth.

### 2. Include the Suggested Fix

The single most impactful thing you can do is include a concrete, code-level suggestion for how to fix the issue. Not "you should fix this" but "here's the specific function in `router-builder.ts` that creates separate contexts, and here's what it should do instead." The maintainer can disagree with your approach, but you've saved them the debugging time.

### 3. Separate Bugs from Feature Requests

KICK-016 was a bug: "this doesn't work." KICK-017 was a feature request: "this should work differently." Filing them separately lets the maintainer triage appropriately.

### 4. Document Your Workaround

If your workaround is good, the maintainer might adopt it as the official fix. If your workaround is terrible, the maintainer knows the pain point and can design something better. Either way, showing that you found a way forward demonstrates that the issue is solvable.

### 5. Track Resolution Publicly

When an issue gets fixed, update your tracker, update your docs, and thank the maintainer. Open source runs on acknowledgment. A "this is fixed in v1.2.5, thank you" comment on a GitHub issue takes 10 seconds and provides outsized motivation.

### 6. Batch Related Issues

Don't file 10 issues in one day. Group related issues, reference each other, and space them out. KICK-016 (the bug) and KICK-017 (the feature request) were filed together because they had the same root cause. That context helped the maintainer see the bigger picture.

---

## The README as a Living Dashboard

The `framework-filed-issues/README.md` file became the project's dashboard for framework health. At any point during development, I could glance at the index table and know:

- Which issues were still blocking (severity + status)
- Which workarounds were still in the codebase
- Which framework versions I needed to upgrade to
- Which issues were candidates for upstream filing

```markdown
## Issue Index

### Bug Reports

| ID | Title | Severity | Status | Fixed In |
|---|---|---|---|---|
| KICK-003 | Modules without routes crash Express | High | Released | v1.2.3 |
| KICK-009 | ctx.set/get not shared | Critical | Released | v1.2.5 |
| KICK-016 | @Service + @Job not auto-registered | High | Released | v1.2.6 |
| KICK-011 | @Inject doesn't work as property decorator | Medium | Open | — |

### Feature Requests

| ID | Title | Status |
|---|---|---|
| KICK-015 | `kick readme` CLI command | Open |
| KICK-017 | @Service auto-registration in DI | Released |
| KICK-018 | Type-safe API client generation | Open |
```

The "Open" issues tell me what workarounds are still in my codebase. The "Released" issues tell me which versions I should upgrade to. The feature requests tell me what I'm hoping for in future releases.

---

## Why Not Just Use GitHub Issues?

I do file on GitHub — eventually. But the local tracker serves a different purpose:

1. **Speed**: I can document an issue the moment I hit it without context-switching to GitHub
2. **Context**: The issue file lives next to the code that triggered it
3. **Completeness**: I can iterate on the description, reproduction steps, and suggested fix before filing publicly
4. **Cross-referencing**: I can reference issue files from code comments, from `framework-issues.md`, and from articles
5. **Offline-friendly**: I can work on issue documentation without an internet connection

The local file is the draft. The GitHub issue is the published version. The two stay in sync via the status field.

---

## What This Approach Gave Us

After 18 issues tracked — 13 bug reports, 1 documentation issue, and 4 feature requests — here's what we got:

- **7 issues fixed** across 4 framework releases
- **Zero abandoned workarounds** — every workaround was either removed (when the fix shipped) or documented (when it's still needed)
- **Clean upgrade path** — when v1.2.5 dropped, I knew exactly which workarounds to remove and which code to update
- **Better framework** — KickJS is genuinely better for having been stress-tested by a real project
- **Better project** — forcing myself to understand root causes made me a better debugger

The cost was maybe 30 minutes per issue for documentation. The return was hundreds of hours of debugging saved for everyone who uses KickJS after me.

If you're building with a young framework — or any framework, really — consider creating a `framework-issues/` directory in your project. It's the most productive form of complaining I've ever found.

---

*This is part of a series on building a Jira-like backend with KickJS. The full project source is available on GitHub.*
