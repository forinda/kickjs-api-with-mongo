# KICK-004: `loadEnv()` returns loosely typed object

- **Status**: Open
- **Severity**: Medium
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: core

## Description
The `defineEnv()` helper accepts a Zod schema to validate environment variables, but its return type collapses to `z.ZodObject<any>` instead of preserving the specific schema shape. As a result, calling `loadEnv(envSchema)` returns `{ [x: string]: any }`, and all environment properties are typed as `unknown` rather than their declared types (e.g., `string`, `number`).

## Steps to Reproduce
1. Define an env schema using `defineEnv()`:
   ```ts
   const envSchema = defineEnv(z.object({
     PORT: z.string().transform(Number),
     DATABASE_URL: z.string(),
   }));
   ```
2. Load the env: `const env = loadEnv(envSchema);`
3. Hover over `env.PORT` in the IDE or check the inferred type.

## Expected Behavior
`env.PORT` should be typed as `number` and `env.DATABASE_URL` as `string`, matching the Zod schema definition.

## Actual Behavior
`env` is typed as `{ [x: string]: any }`. All properties are `any`/`unknown`, defeating the purpose of schema-based validation.

## Error / Stack Trace
```
No runtime error — this is a compile-time type inference issue.
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Cast the result with an explicit type assertion:
```ts
const env = loadEnv(envSchema) as { PORT: number; DATABASE_URL: string };
```

## Suggested Fix
Fix the generic signature of `defineEnv()` and `loadEnv()` to propagate the schema type parameter. For example:
```ts
function defineEnv<T extends z.ZodRawShape>(schema: z.ZodObject<T>): z.ZodObject<T>;
function loadEnv<T extends z.ZodRawShape>(schema: z.ZodObject<T>): z.infer<z.ZodObject<T>>;
```

## References
- framework-issues.md section
