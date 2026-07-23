# ADR 0005: Make Arabic and RTL the default experience

- Status: Accepted
- Date: 2026-07-23

## Context

Wasel launches in Egypt. Treating Arabic as a later translation would embed LTR
assumptions throughout layouts and content.

## Decision

Use `ar-EG` as the default locale, set document language and direction at the
root, use logical CSS properties, explicitly support React Native RTL, and keep
message keys shared. English remains a supported expansion locale.

## Consequences

RTL defects surface early. Components must avoid physical left/right assumptions
and every visual review must include Arabic content.
