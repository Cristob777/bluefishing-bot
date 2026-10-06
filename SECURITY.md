# BlueFishing Strategic Cybersecurity Baseline

Version: 1.0

This baseline operationalizes the BlueFishing WhatsApp agent around NIST CSF 2.0, NIST AI RMF / Generative AI Profile, and the OWASP GenAI / LLM Top 10. It is an engineering control profile, not a certification claim.

## Security objective

A successful prompt injection or model manipulation must not be sufficient to disclose credentials, environment variables, database connection information, infrastructure details, private conversation data, internal prompts, or privileged functionality.

The language model is treated as a potentially fallible component. Authorization and data-loss controls live outside the model.

## GOVERN

- Security contracts are version-controlled.
- High-risk tools are forbidden or require human approval.
- Secrets are never committed to Git or embedded in system prompts.
- Production secrets stay only in the Hostinger server protected environment file or a dedicated secret manager.
- Security-affecting changes must pass CI before deployment.

## IDENTIFY

Protected assets include OpenAI credentials, Meta/WhatsApp credentials, WooCommerce credentials, PostgreSQL credentials and customer conversation data, product knowledge, handoffs and telemetry.

Primary threats include direct and indirect prompt injection, sensitive-information disclosure, malicious output, forged Meta webhook requests, abuse, log leakage and compromised containers.

## PROTECT

- Verify Meta X-Hub-Signature-256 before processing POST callbacks.
- Treat product, web and customer text as untrusted data.
- Validate URLs, prices, stock claims, technical claims and internal-information leakage before sending model output.
- Fail closed to a deterministic response on contract violation.
- Use least-privilege tool permissions.
- PostgreSQL and the app are internal-only; Caddy exposes only 80/443.
- Run the app non-root, drop Linux capabilities and use no-new-privileges.
- Keep the filesystem read-only except explicit writable mounts/tmp.
- Redact credentials from logs and pseudonymize customer identifiers.
- Public health output must not expose architecture or configuration.

## DETECT

Log only sanitized events for prompt-injection attempts, failed Meta signatures, response-contract violations, rate limiting and runtime failures.

Never log full WhatsApp text, tokens, query strings, Authorization headers, environment variables or connection strings.

## RESPOND

On prompt injection, do not execute policy-changing instructions and return a generic sales-scope response.

On output validation failure, discard the complete model output and use the deterministic grounded fallback.

On suspected credential exposure or confirmed compromise, rotate affected credentials, revoke external tokens, stop the application if integrity cannot be established, preserve sanitized logs, and redeploy from a known-good Git commit.

## RECOVER

Rebuild containers from repository source, restore PostgreSQL from encrypted off-host backup, rotate secrets before reconnecting external services, and run security plus functional smoke tests before reopening WhatsApp.

## Prompt-injection boundary

The model is never the sole control for authorization, secret protection, tool permissions, price/stock truth, database access or policy enforcement.

Even if the exact system prompt becomes known, it must contain no credential and grant no privileged access.
