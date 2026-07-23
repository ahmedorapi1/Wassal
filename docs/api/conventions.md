# API conventions

The API exposes `GET /api/v1/health` plus the Phase 1 identity, merchant,
courier, and administration endpoints documented in
[Phase 1 routes](phase-1-routes.md).

Endpoints follow these conventions:

- Prefix all routes with `/api/v1` and use JSON over HTTPS.
- Authenticate with short-lived bearer access tokens and rotated refresh tokens.
- Accept `Idempotency-Key` on order creation and financial commands.
- Accept an aggregate version on state-changing commands and reject stale writes.
- Validate requests with shared Zod schemas at the boundary.
- Return stable machine-readable error codes.
- Propagate a client request ID or create one at ingress; include it in logs and responses.
- Never expose provider-specific identifiers unless the contract requires them.
- Paginate list endpoints with opaque cursors.

Error envelope:

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request is invalid"
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

State transitions, dispatch concurrency, and financial transactions require
integration tests against PostgreSQL; mocks are insufficient for those rules.
