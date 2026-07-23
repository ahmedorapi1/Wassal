# Courier document security

Courier identity documents are private objects, never public assets.

## Local development

- upload is authenticated multipart form data
- Multer and the service enforce a 5 MiB default limit
- allowed media types are JPEG, PNG, and PDF
- magic bytes must match the declared media type
- the server generates an opaque object key
- paths are resolved beneath `STORAGE_LOCAL_DIR` with traversal protection
- SHA-256, media type, original filename, and byte size are stored
- API responses omit `storageKey`
- download streams through an authenticated owner/reviewer endpoint with
  `Cache-Control: private, no-store`

Replacing evidence creates a new row and marks the old row `SUPERSEDED`. Review
history is retained. No submitted file is silently overwritten.

## Production adapter

The `ObjectStorageProvider` port is ready for an S3-compatible implementation.
It should use private buckets, KMS-backed encryption, short-lived signed
operations, length/type/checksum constraints, quarantine and malware scanning,
retention controls, and audit logging without document bytes.

The local adapter is for development and controlled testing only.
