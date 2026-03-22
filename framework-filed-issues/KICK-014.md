# KICK-014: `ApiQueryParamsConfig` type name mismatch in docs

- **Status**: Open
- **Severity**: Low
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: core

## Description
The documentation references `QueryParamsConfig` as the type for configuring API query parameters, but the actual export from `@forinda/kickjs-core` is `ApiQueryParamsConfig`. This causes a compile error when following the docs.

## Steps to Reproduce
1. Follow the documentation and write:
   ```ts
   import type { QueryParamsConfig } from '@forinda/kickjs-core';
   ```
2. Run the TypeScript compiler
3. Receive an error that `QueryParamsConfig` is not exported from the module

## Expected Behavior
The import name referenced in documentation should match the actual export from the package, or both names should be available.

## Actual Behavior
`QueryParamsConfig` is not exported. The correct export name is `ApiQueryParamsConfig`, which is not mentioned in the documentation.

## Error / Stack Trace
```
error TS2305: Module '"@forinda/kickjs-core"' has no exported member 'QueryParamsConfig'.

  import type { QueryParamsConfig } from '@forinda/kickjs-core';
                ~~~~~~~~~~~~~~~~~
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Use the correct export name:

```ts
import type { ApiQueryParamsConfig } from '@forinda/kickjs-core';
```

## Suggested Fix
Add `QueryParamsConfig` as a re-export alias in `@forinda/kickjs-core` for backward compatibility with the docs, or update the documentation to reference `ApiQueryParamsConfig`.

## References
- framework-issues.md section
