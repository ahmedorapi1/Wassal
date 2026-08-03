# ADR 0001: Start with a modular monolith

- Status: Accepted
- Date: 2026-07-23

## Context

WASSAL needs transactionally safe order assignment, state changes, and financial
records while the domain and operating model are still evolving.

## Decision

Use one modular NestJS API and one background worker, backed by one PostgreSQL
database. Organize code by explicit domain module and prohibit direct cross-module
table access. Do not create microservices in the MVP.

## Consequences

Cross-domain transactions remain straightforward and local development is
simple. Module boundaries require review discipline. Extraction remains possible
when load, ownership, or deployment evidence warrants the added complexity.
