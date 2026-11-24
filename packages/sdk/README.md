# @opikey/sdk

No runtime dependencies or telemetry. Node 18+, Bun, Deno and edge fetch runtimes.

```ts
import { Opi, OpiApprovalRequiredError } from '@opikey/sdk';
const opi = new Opi(); // OPIKEY environment variable; never print it
const response = await opi.fetch('openai', '/v1/models');
const names = await opi.loadSecrets({ only: ['OPENAI_API_KEY'] }); // no overrides
const metadata = await opi.listSecrets();
```

In non-Node runtimes provide `{ key, baseUrl }` and a `target` object to `loadSecrets`. Variable names must be valid environment identifiers. Names such as `openai` are not automatically mapped to `OPENAI_API_KEY`: name the vault entry as the variable your app expects.

Catch `OpiApprovalRequiredError`, wait with `opi.waitForApproval(error.approvalId, { timeoutMs: 120000 })`, then retry the identical request with the `x-opi-approval` header. Other errors extend `OpiError` with a safe `code` and HTTP `status`. Never log native fetch errors, request/response bodies, or credentials. Base URLs require HTTPS, except `http://localhost` for development.

Publish only through the pinned GitHub OIDC workflow; no npm token belongs in this repository.

## Secret names and environment variables

`loadSecrets()` writes each secret as an environment variable. Names that are already valid environment variable names are used as they are (`OPENAI_API_KEY`, `openai`). Other names are converted: letters are uppercased and every other character becomes `_`, so `httpbin-test` becomes `HTTPBIN_TEST` and `stripe.live` becomes `STRIPE_LIVE`. A name starting with a digit gets a leading `_`.

If two secrets would end up with the same variable name, `loadSecrets()` throws an `env_name_conflict` error and loads nothing, so one secret never silently overwrites another. The `only` option accepts either the original secret name or the variable name. `toEnvName(name)` is exported if you need the mapping yourself.
