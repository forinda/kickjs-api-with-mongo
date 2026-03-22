# KICK-019: `kick g module` should ensure `vite/client` types in tsconfig.json

- **Status**: Open
- **Severity**: Low
- **Found in**: v1.2.7
- **Fixed in**: —
- **Component**: cli
- **Type**: Bug / DX

## Description
KickJS module generators (DDD, REST, CQRS patterns) produce `import.meta.glob([...], { eager: true })` calls for eager loading of decorated classes. TypeScript does not recognize `import.meta.glob` without the `vite/client` type definitions, causing a compile error:

```
Property 'glob' does not exist on type 'ImportMeta'.
```

## Steps to Reproduce
1. Create a new project with `kick new`
2. Generate a module: `kick g module cat --pattern ddd`
3. Run `tsc --noEmit`
4. TypeScript errors on the `import.meta.glob` line in the generated `index.ts`

## Expected Behavior
Generated code should compile without additional manual configuration. Either:
- The generator adds `"vite/client"` to `tsconfig.json` automatically
- Or `kick new` includes it in the initial scaffold

## Actual Behavior
TypeScript fails with `Property 'glob' does not exist on type 'ImportMeta'` until the developer manually adds `"vite/client"` to `compilerOptions.types`.

## Workaround
Add `"vite/client"` to `tsconfig.json`:
```json
{
  "compilerOptions": {
    "types": ["vite/client"]
  }
}
```

## Suggested Fix
Option A: `kick new` should include `"vite/client"` in the generated `tsconfig.json` since KickJS is Vite-based.

Option B: `kick g module` should check if `vite/client` is in `tsconfig.json` types and add it if missing (similar to how it auto-updates `src/modules/index.ts`).

## References
- framework-issues.md issue #14
