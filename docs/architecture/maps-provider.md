# Maps and route provider integration

`@wasel/providers` exposes a maps port for coordinate validation and
pickup-to-drop-off route distance/duration. Domain services depend on this
interface, not a vendor SDK.

`DeterministicLocalMapsProvider` is used in development and tests. It validates
coordinates, calculates a deterministic great-circle baseline, applies a
documented road factor, and derives duration from a fixed motorcycle speed.
It sends no network request and requires no paid credential.

The backend is the distance authority. Browser/mobile map input never
calculates a billable distance.

To add production routing later:

1. implement the same port in `packages/providers`;
2. store credentials only in managed deployment secrets;
3. add timeouts, bounded retries, circuit breaking, observability, and safe
   redaction;
4. normalize vendor responses to meters/seconds and validate route limits;
5. select the adapter in dependency injection by environment;
6. retain the provider name/version in quote and order route snapshots.

Geocoding and optional route geometry can extend the port without changing
Phase 2 price or order contracts.
