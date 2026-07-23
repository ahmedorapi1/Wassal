# Deployment boundary

Production deployment manifests are intentionally deferred. Phase 0 records the
deployment boundary without choosing a cloud provider: stateless Node.js app
processes, managed PostgreSQL/PostGIS, managed Redis, and S3-compatible storage.
