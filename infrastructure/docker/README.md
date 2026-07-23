# Local containers

The canonical local stack is defined in the repository-root `compose.yaml`.
It runs PostgreSQL 18 with PostGIS 3.6 and Redis 8 with persistent named volumes
and health checks. Application containers intentionally remain out of Phase 0;
the five apps run with the local Node.js toolchain for fast iteration.
