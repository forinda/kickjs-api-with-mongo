# KICK-001: `kick new` interactive prompt not scriptable

- **Status**: Open
- **Severity**: Low
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: cli

## Description
The `kick new` command always launches an interactive prompt for template selection, even when stdin is piped or redirected. There is no `--template` flag to bypass the interactive picker, making it impossible to use `kick new` in CI/CD pipelines or shell scripts without resorting to hacks.

## Steps to Reproduce
1. Run `kick new my-app --pm pnpm --no-git --install` in a non-interactive shell (e.g., inside a CI pipeline or with stdin redirected).
2. Observe that the command hangs or fails waiting for interactive template selection input.

## Expected Behavior
A `--template <name>` flag should allow specifying the project template non-interactively, e.g. `kick new my-app --template rest --pm pnpm --no-git --install`.

## Actual Behavior
The command always prompts interactively for template selection regardless of the environment. There is no CLI flag to skip the prompt.

## Error / Stack Trace
```
No error thrown — the process hangs waiting for TTY input when stdin is not a terminal.
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Pipe a selection number into stdin:
```bash
echo "1" | kick new my-app --pm pnpm --no-git --install
```

## Suggested Fix
Support a `--template rest` (or `--template graphql`, etc.) flag on `kick new` that bypasses the interactive prompt entirely when provided.

## References
- framework-issues.md section
