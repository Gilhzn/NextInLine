import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

const IV_LEN = 12;
const TAG_LEN = 16;

function seal(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function open(key: Buffer, sealed: Buffer): Buffer {
  const iv = sealed.subarray(0, IV_LEN);
  const tag = sealed.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = sealed.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Envelope encryption: each file gets its own data key (DEK); the DEK is wrapped with the master key.
 * In production the master key lives in a KMS; here it comes from configuration.
 */
export class Crypto {
  private readonly master: Buffer;

  constructor(masterKey: string) {
    const decoded = Buffer.from(masterKey, "base64");
    // A base64 32-byte key is used as-is; any other secret (e.g. a platform-generated one) is hashed to 256 bits.
    this.master = decoded.length === 32 ? decoded : createHash("sha256").update(masterKey, "utf8").digest();
  }

  encryptFile(plaintext: Buffer): { ciphertext: Buffer; wrappedKey: string } {
    const dek = randomBytes(32);
    return { ciphertext: seal(dek, plaintext), wrappedKey: `v1:${seal(this.master, dek).toString("base64")}` };
  }

  decryptFile(ciphertext: Buffer, wrappedKey: string): Buffer {
    const dek = open(this.master, Buffer.from(wrappedKey.replace(/^v1:/, ""), "base64"));
    return open(dek, ciphertext);
  }

  encryptString(value: string): string {
    return `v1:${seal(this.master, Buffer.from(value, "utf8")).toString("base64")}`;
  }

  decryptString(value: string): string {
    return open(this.master, Buffer.from(value.replace(/^v1:/, ""), "base64")).toString("utf8");
  }
}
