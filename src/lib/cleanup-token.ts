type CleanupPayload = {
  exp: number;
  leadSubmissionIds: string[];
  auditSubmissionIds: string[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign", "verify"],
  );
}

export async function createCleanupToken(
  secret: string,
  leadSubmissionIds: string[],
  auditSubmissionIds: string[],
): Promise<string> {
  const payload: CleanupPayload = {
    // Token expires after 10 minutes.
    exp: Date.now() + 10 * 60 * 1000,
    leadSubmissionIds,
    auditSubmissionIds,
  };

  const payloadPart = bytesToBase64Url(
    encoder.encode(JSON.stringify(payload)),
  );

  const key = await importKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payloadPart),
  );

  return `${payloadPart}.${bytesToBase64Url(
    new Uint8Array(signature),
  )}`;
}

export async function verifyCleanupToken(
  secret: string,
  token: string,
): Promise<CleanupPayload> {
  const [payloadPart, signaturePart] = token.split(".");

  if (!payloadPart || !signaturePart) {
    throw new Error("Invalid cleanup token.");
  }

  const key = await importKey(secret);

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(signaturePart),
    encoder.encode(payloadPart),
  );

  if (!valid) {
    throw new Error("Invalid cleanup token signature.");
  }

  const payload = JSON.parse(
    decoder.decode(base64UrlToBytes(payloadPart)),
  ) as CleanupPayload;

  if (
    !payload ||
    !Array.isArray(payload.leadSubmissionIds) ||
    !Array.isArray(payload.auditSubmissionIds) ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Invalid cleanup token payload.");
  }

  if (Date.now() > payload.exp) {
    throw new Error("Cleanup token expired.");
  }

  return payload;
}
