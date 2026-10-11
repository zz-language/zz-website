// Shared validation patterns for Pages Functions API routes.
//
// PKG_NAME_RE: lowercase alphanumerics, dash, underscore. The dash is LAST
// in the class on purpose: `[a-z0-9-_]` would parse `9-_` as a range
// (0x39-0x5F, i.e. `:;<=>?@A-Z[\]^`), silently accepting uppercase and
// symbols. Keep in sync with `zz-registry/src/validate.zz valid_name`.
export const PKG_NAME_RE = /^[a-z0-9_-]+$/;

// Strict full semver for publish/download paths (no ranges, no prefixes).
export const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// Hex SHA-256 for client-claimed tarball hashes.
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
