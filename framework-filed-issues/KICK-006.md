# KICK-006: Mongoose `OverwriteModelError` during HMR

- **Status**: Open
- **Severity**: High
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: http

## Description
When running `kick dev`, the Vite-based HMR pipeline re-executes schema definition files on each hot reload. Files that call `mongoose.model('Name', schema)` throw `OverwriteModelError` on the second execution because the model is already registered in Mongoose's internal registry from the first load.

## Steps to Reproduce
1. Create a Mongoose schema file:
   ```ts
   const userSchema = new Schema({ name: String });
   export const User = mongoose.model('User', userSchema);
   ```
2. Start the dev server with `kick dev`.
3. Edit any file that triggers HMR (e.g., save a controller).
4. Observe the error in the terminal.

## Expected Behavior
HMR should not crash when schema files are re-executed. The framework's code generator or documentation should produce HMR-safe model definitions.

## Actual Behavior
Mongoose throws `OverwriteModelError`:
```
OverwriteModelError: Cannot overwrite `User` model once compiled.
```

## Error / Stack Trace
```
OverwriteModelError: Cannot overwrite `User` model once compiled.
    at Mongoose.model (node_modules/mongoose/lib/index.js:XXX:XX)
    at Object.<anonymous> (src/modules/users/models/user.model.ts:XX:XX)
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Use a guard pattern in all model files:
```ts
export const User = mongoose.models.User || mongoose.model('User', userSchema);
```

## Suggested Fix
The `kick generate model` command (and any scaffolding templates) should emit the HMR-safe pattern by default:
```ts
export const User = mongoose.models.User || mongoose.model('User', userSchema);
```

## References
- framework-issues.md section
