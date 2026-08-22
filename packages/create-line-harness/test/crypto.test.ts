import { describe, expect, test } from "vitest";
import {
  encryptCredentialForSetup,
  generateCredentialEncryptionKey,
} from "../src/lib/crypto.js";

describe("LINE credential setup encryption", () => {
  test("generates a 256-bit key and randomizes AES-GCM ciphertext", async () => {
    const key = generateCredentialEncryptionKey();
    expect(Buffer.from(key, "base64")).toHaveLength(32);

    const first = await encryptCredentialForSetup("credential", key);
    const second = await encryptCredentialForSetup("credential", key);

    expect(first).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(second).not.toBe(first);
  });
});
