# KICK-011: `@Inject(TOKEN)` doesn't work as property decorator

- **Status**: Open
- **Severity**: Medium
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: core

## Description
`@Inject(TOKEN)` is designed for constructor parameter injection only. Using it as a class property decorator causes a TypeScript compilation error (`TS1240`). The documentation and examples do not make this distinction clear, leading developers to assume `@Inject` can be used on properties the same way `@Autowired()` can.

## Steps to Reproduce
1. Write a class with `@Inject(TOKEN)` on a property:
   ```ts
   class MyService {
     @Inject(TOKENS.REPO) private repo!: IRepo;
   }
   ```
2. Run the TypeScript compiler
3. Receive error `TS1240: Unable to resolve signature of property decorator when called as an expression`

## Expected Behavior
Either `@Inject(TOKEN)` should work as a property decorator (resolving the token from the DI container and assigning the value to the property), or the documentation should clearly state that `@Inject` is constructor-parameter-only.

## Actual Behavior
TypeScript throws `TS1240` at compile time. The decorator signature does not match what TypeScript expects for a property decorator.

## Error / Stack Trace
```
error TS1240: Unable to resolve signature of property decorator when called as an expression.
  Type 'ParameterDecorator' has no call signatures.

  @Inject(TOKENS.REPO) private repo!: IRepo;
  ~~~~~~~~~~~~~~~~~~~~
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Use `@Autowired()` for property injection (resolves by class type). Use `@Inject(TOKEN)` only in constructor parameters:

```ts
class MyService {
  @Autowired() private repo!: ConcreteRepo; // property — by type

  constructor(@Inject(TOKENS.REPO) repo: IRepo) {} // constructor — by token
}
```

## Suggested Fix
Either make `@Inject` return a union decorator that satisfies both `ParameterDecorator` and `PropertyDecorator` signatures, or add explicit documentation stating that `@Inject` is constructor-parameter-only and `@Autowired` is the property equivalent.

## References
- framework-issues.md section
