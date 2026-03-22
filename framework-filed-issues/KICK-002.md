# KICK-002: Nodemailer peer dependency mismatch

- **Status**: Open
- **Severity**: Low
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: mailer

## Description
The `@forinda/kickjs-mailer@1.2.2` package declares a peer dependency on `nodemailer@^6.0.0`, but running `kick add mailer` installs `nodemailer@8.0.3`. This results in an unmet peer dependency warning and may cause runtime incompatibilities if the mailer adapter relies on nodemailer v6-specific APIs.

## Steps to Reproduce
1. Scaffold a new KickJS project: `kick new my-app --pm pnpm`.
2. Run `kick add mailer` to add the mailer module.
3. Observe the peer dependency warning in the install output.

## Expected Behavior
The installed version of `nodemailer` should satisfy the peer dependency range declared by `@forinda/kickjs-mailer`, or the peer dependency range should be updated to include v8.

## Actual Behavior
The following warning is emitted during installation:
```
✕ unmet peer nodemailer@^6.0.0: found 8.0.3
```

## Error / Stack Trace
```
✕ unmet peer nodemailer@^6.0.0: found 8.0.3
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Ignore the warning for now. Nodemailer v8 appears to work at runtime, but the warning clutters install output and may mask real issues.

## Suggested Fix
Update the peer dependency range in `@forinda/kickjs-mailer` to `nodemailer@^6.0.0 || ^8.0.0` (or simply `>=6.0.0`) to accept the version that `kick add mailer` actually installs.

## References
- framework-issues.md section
