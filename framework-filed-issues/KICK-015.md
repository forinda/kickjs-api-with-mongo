# KICK-015: No `kick readme` CLI command

- **Status**: Open
- **Severity**: Low
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: cli

## Description
`kick new` scaffolds a project but does not generate a `README.md`. There is also no CLI command to generate one from the current project state. Developers must manually create and maintain a README, which often falls out of sync with the actual project configuration.

## Steps to Reproduce
1. Run `kick new my-app` to scaffold a new project
2. Check the generated project directory
3. No `README.md` file exists
4. Run `kick --help` to look for a readme command
5. No such command is available

## Expected Behavior
A `kick readme` command should exist that generates a `README.md` by introspecting the project. Additionally, `kick new` should produce an initial README as part of scaffolding.

## Actual Behavior
No README is generated and no CLI command exists to create one.

## Error / Stack Trace
```
$ kick readme
error: unknown command 'readme'
Run 'kick --help' for available commands.
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Manually create and maintain a `README.md` file.

## Suggested Fix
Add a `kick readme` command that introspects:

- `package.json` (name, description, scripts, dependencies)
- Installed `@forinda/kickjs-*` packages and their versions
- Registered modules and adapters
- Defined routes and controllers
- Required environment variables from `.env.example`

The command should generate a structured `README.md` with sections for setup, configuration, available routes, and architecture. It should also run automatically as part of `kick new` scaffolding.

## References
- framework-issues.md section
