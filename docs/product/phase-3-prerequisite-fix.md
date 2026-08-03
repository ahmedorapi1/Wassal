# Phase 3 prerequisite fix

Phase 3 dispatch work is gated on a real Android authentication and document
upload journey. This record covers the prerequisite changes only; it is not a
Phase 3 completion report.

## Android upload root cause

The failing implementation treated the picker URI as an immediately readable
modern `expo-file-system` `File`, rejected it when `File.exists` was false, and
then attempted a second modern `File.copy` before upload. That assumption is
not valid for every Android document provider in Expo Go, particularly when
the selection is represented by a temporary `content://` grant. The generic
Arabic error was emitted before FormData, HTTP, Multer, object storage, or
authentication code ran.

The previous workaround then used the new native `File.upload` multipart path,
which does not exercise React Native's documented FormData file-part shape and
had previously produced `Unsupported FormDataPart implementation` on the same
device flow. The corrected boundary is: provider URI → verified private
`file://` cache copy → React Native `{uri,name,type}` FormData part → global
React Native `fetch`.

## Reliability fixes

- The courier app installs newly issued OTP tokens before its first profile
  request.
- Authenticated JSON requests share a single-flight refresh coordinator.
  Concurrent 401 responses rotate the refresh token once, each request retries
  at most once, and a rejected rotated token clears the session.
- Native document upload retries once after the same coordinated rotation and
  reloads the document list with the current token rather than stale React
  state.
- Android image selection uses `expo-image-picker`; PDF selection uses
  `expo-document-picker`. The latter intentionally preserves a provider
  `content://` URI so the application owns and verifies the cache copy.
- Selected `content://` and `file://` inputs are copied through
  `expo-file-system/legacy.copyAsync`, whose Android compatibility contract
  supports both schemes as sources and a private `file://` destination.
- The upload validates the actual cached byte count, uses a normalized
  user-facing filename independently from its ASCII cache path, and removes the
  private cache copy after the request.
- Multipart upload now uses React Native's supported native file part
  `{ uri, name, type }` with the platform `FormData` and global `fetch`. It does
  not set `Content-Type` manually, allowing React Native to generate the
  multipart boundary. Each authentication retry builds a new body.
- Logout clears SecureStore tokens plus all in-memory profile, vehicle,
  document, verification, challenge, OTP, message, and navigation state.
- Android rejects an unresolved loopback API URL and can derive the LAN API
  host from Metro. The root courier script now loads the root `.env`.
- Development upload logging retains status, MIME type, and byte count but no
  device file URI, original filename, token, or response body.
- The admin interface fetches document bytes with its bearer token, keeps the
  object URL local to the browser, and revokes it after viewing.
- Private file responses include `private, no-store`, `nosniff`, exact length,
  a safe ASCII fallback filename, and an RFC 5987 Unicode filename.
- Courier approval reads related user, vehicle, and document records
  sequentially inside its interactive transaction. This removes Prisma's
  overlapping use of one `pg` client and the `client.query()` deprecation
  warning reproduced with `--trace-deprecation`.

## Regression coverage

- New-token first request.
- Concurrent single-flight refresh rotation.
- No refresh retry loop and failed-session cleanup.
- Corrupt stored-token cleanup.
- Explicit and Metro-derived non-loopback Android API URLs.
- Android provider-URI cache staging for both `content://` and `file://`.
- Actual cached-size validation and unreadable-copy rejection.
- Exact React Native `{uri,name,type}` multipart construction.
- Secure admin bearer-token document fetch and authorization rejection.
- Safe private-file response headers.
- Courier review integration without the `pg` concurrent-query warning.
- Real multipart JPG, PNG, and PDF persistence plus authorized admin retrieval
  remains covered by the Phase 1 integration suite.

## Required real-device gate

The following must all be observed on a physical Android device before dispatch
implementation may begin:

1. Start the API on `0.0.0.0:3100` and Metro on the repository-supported Node
   version.
2. Open the app from Expo Go using the LAN Metro URL.
3. Complete mock-OTP sign-in and confirm the first profile request succeeds.
4. Force one expired access-token path and confirm one refresh without a loop.
5. Upload one JPG, one PNG, and one PDF.
6. Sign in as an authorized operations admin and open all three private files.
7. Log out, relaunch, and confirm no authenticated state remains.

Record the physical device, Android version, effective non-loopback API URL,
and observed results here after the test. Dispatch remains blocked until then.
