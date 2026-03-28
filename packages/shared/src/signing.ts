import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize } from "./canonical-json.js";

const NAMESPACE = "chat-mcp";

/**
 * Hash a payload for signing. Takes an object, canonicalizes it via JCS,
 * then returns the SHA-256 hash as a hex string.
 */
export function hashPayload(payload: unknown): string {
  const canonical = canonicalize(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

function execFilePromise(
  cmd: string,
  args: string[],
  stdin?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = execFile(cmd, args, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });
    if (stdin !== undefined) {
      proc.stdin?.write(stdin);
      proc.stdin?.end();
    }
  });
}

/**
 * Sign a payload using an SSH private key.
 * Shells out to `ssh-keygen -Y sign`.
 */
export async function sign(
  privateKeyPath: string,
  payload: unknown,
): Promise<string> {
  const canonical = canonicalize(payload);
  const tmpDir = await mkdtemp(join(tmpdir(), "chat-mcp-sign-"));
  const dataFile = join(tmpDir, "data");
  const sigFile = join(tmpDir, "data.sig");

  try {
    await writeFile(dataFile, canonical);
    await execFilePromise("ssh-keygen", [
      "-Y", "sign", "-f", privateKeyPath, "-n", NAMESPACE, dataFile,
    ]);
    const sig = await readFile(sigFile, "utf-8");
    return sig.trim();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Verify a signature against a public key and payload.
 * Shells out to `ssh-keygen -Y verify`.
 */
export async function verify(
  publicKey: string,
  payload: unknown,
  signature: string,
  signerIdentity: string,
): Promise<boolean> {
  const canonical = canonicalize(payload);
  const tmpDir = await mkdtemp(join(tmpdir(), "chat-mcp-verify-"));
  const sigFile = join(tmpDir, "data.sig");
  const allowedSignersFile = join(tmpDir, "allowed_signers");

  try {
    await writeFile(sigFile, signature);
    await writeFile(allowedSignersFile, `${signerIdentity} ${publicKey}\n`);

    await execFilePromise(
      "ssh-keygen",
      [
        "-Y", "verify",
        "-f", allowedSignersFile,
        "-I", signerIdentity,
        "-n", NAMESPACE,
        "-s", sigFile,
      ],
      canonical,
    );
    return true;
  } catch {
    return false;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Get the fingerprint of an SSH public key.
 */
export async function fingerprint(publicKey: string): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), "chat-mcp-fp-"));
  const keyFile = join(tmpDir, "key.pub");

  try {
    await writeFile(keyFile, publicKey + "\n");
    const { stdout } = await execFilePromise("ssh-keygen", ["-l", "-f", keyFile]);
    const match = stdout.match(/SHA256:\S+/);
    return match ? match[0] : stdout.trim();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
