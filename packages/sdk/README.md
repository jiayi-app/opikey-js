# @opikey/sdk

The SDK for OPIKey, the AI-native API Gateway. One OPI Key for every API in your Vault: ask in plain language with AI mode, or make exact calls. The real API keys never reach your code, and the AI Firewall checks every request and response.

No runtime dependencies or telemetry. Node 18+, Bun, Deno and edge fetch runtimes.

```bash
npm install @opikey/sdk
```

```ts
import { OpiKey } from '@opikey/sdk';
const opi = new OpiKey(); // reads OPIKEY_KEY; or new OpiKey({ key })
```

OPI Keys belong on servers and in agents. The constructor refuses to run in browser code unless you pass `allowBrowser: true` for a key that allows your site's origin.

## AI mode

Ask for what you need. OPIKey's AI picks the right APIs this key may use, makes the calls and returns the result.

```ts
const r = await opi.ai('send Sam a receipt for order 1042 with Resend');
r.status;  // 'done' | 'needs_confirmation' | 'blocked'
r.result;  // the answer
r.calls;   // [{ api, method, path, status }]
r.usage;   // { api_calls, model, input_tokens, output_tokens, model_cost_usd, ai_credits, call_credits, total_credits }
r.check;   // the AI Firewall's verdict

// Risky writes (deletes, mass sends, payments…) come back as a preview first:
if (r.status === 'needs_confirmation') {
  console.log(r.reason, r.planned_calls);
  await opi.ai('send Sam a receipt for order 1042 with Resend', { confirmId: r.confirm_id });
}
```

`confirm_id` works once, for the same input, within 15 minutes. Use `{ model: 'smart' }` for harder requests: it costs much more per request than the default `fast` model.

## Exact calls

```ts
const { response, check, usage, creditsCharged } = await opi.call({
  api: 'stripe', method: 'POST', path: '/v1/refunds', body: { charge: 'ch_123' },
});
```

`api` is the name of the API in your Vault. The provider's response comes back unchanged, including its own error responses. OPIKey errors (credits, key limits, the AI Firewall) throw. `opi.fetch(api, path, init)` returns the raw `Response` and throws on any non-2xx.

## Usage

```ts
await opi.usage();
// { credits_left, credits_included, credits_used, extra_credits_left, resets_at,
//   breakdown: { api_calls, ai_mode, ai_firewall } }
```

## Load secrets at startup (fetch mode)

For keys with fetch mode turned on:

```ts
const names = await opi.loadSecrets({ only: ['OPENAI_API_KEY'] }); // never overrides existing variables
const metadata = await opi.listSecrets(); // names only, never values
```

Valid environment-variable names are kept. Others are uppercased with every other character turned into `_` (`httpbin-test` → `HTTPBIN_TEST`). If two secrets map to the same name, `loadSecrets()` throws `env_name_conflict` and loads nothing.

## Errors

Every error extends `OpiError` (also exported as `OpiKeyError`), with a safe `code`, HTTP `status` and `details` (numbers and short identifiers only, never response content).

| Error | When |
|---|---|
| `OpiAuthError` | 401 `invalid_key`: missing, wrong or revoked OPI Key |
| `OpiInsufficientCreditsError` (also `InsufficientCreditsError`) | 402 `insufficient_credits` |
| `OpiForbiddenError` | 403, including `browser_origin_blocked` |
| `OpiApprovalRequiredError` | 403 `approval_required` / `check_held`: the owner must approve. Wait with `opi.waitForApproval(error.approvalId, { timeoutMs })` |
| `OpiSecurityBlockedError` | 403 `security_blocked`: blocked by the AI Firewall |
| `OpiConfirmationError` | 409 `confirmation_invalid`: the confirm_id is unknown, used, expired or for another input |
| `OpiFeaturePausedError` | 410 `feature_paused` |
| `OpiBudgetExhaustedError` | 429 `call_limit_reached`: this key's own limit is used up |
| `OpiRateLimitError` | 429 `rate_limited` |
| `OpiAiUnavailableError` | 503 `ai_mode_unavailable`: nothing was charged |
| `OpiEncryptionUnavailableError` | Encryption is temporarily unavailable |
| `OpiTimeoutError` | A wait timed out |

Never log native fetch errors, request or response bodies, or credentials. Base URLs require HTTPS, except `http://localhost` for development.

## Upgrading from 0.3

- `Opi` is now `OpiKey`. `Opi` still works as an alias.
- The key is read from `OPIKEY_KEY`. `OPIKEY` still works.
- `opi.ai.run()` / `runAndWait()` are replaced by `opi.ai(input)`.
- Removed with the features they used: `opi.keys` (sub-keys) and `opi.inbox`.
- `opi.credits()` is deprecated. Use `opi.usage()`.

Publish only through the pinned GitHub OIDC workflow; no npm token belongs in this repository.
