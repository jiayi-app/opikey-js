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
