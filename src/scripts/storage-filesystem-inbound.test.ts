import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { gunzipSync } from "node:zlib";

const raw = Buffer.from("From: sender@example.test\r\nSubject: Recepcao\r\n\r\nMensagem de teste\u0000");
const pendingKey = "incoming/00000000-0000-4000-8000-000000000001.eml";
const calls: string[] = [];
const server = createServer((request, response) => {
  calls.push(`${request.method} ${request.url}`);
  if (request.method !== "GET" || !request.url?.startsWith(`/recovery/${pendingKey}`)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Length": raw.length, "x-amz-meta-from": "sender@example.test" }).end(raw);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const localDir = await mkdtemp(join(tmpdir(), "mail-filesystem-inbound-"));
process.env.NODE_ENV = "test";
process.env.MAIL_STORAGE_DRIVER = "filesystem";
process.env.MAIL_STORAGE_DIR = localDir;
process.env.MAIL_R2_ENDPOINT = `http://127.0.0.1:${address.port}`;
process.env.MAIL_R2_BUCKET = "recovery";
process.env.MAIL_R2_ACCESS_KEY_ID = "test-access";
process.env.MAIL_R2_SECRET_ACCESS_KEY = "test-secret";
process.env.MAIL_INBOUND_TOKEN = "test-inbound";
const storage = await import("../lib/storage.js");
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(localDir, { recursive: true, force: true });
});

test("recebe a fila R2 e mantém as mensagens no filesystem", async () => {
  await storage.ensureStorageDir();
  const saved = await storage.storeRaw("local-message", raw, new Date("2026-11-14T00:00:00Z"));
  assert.deepEqual(gunzipSync(await readFile(join(localDir, saved.storageKey))), raw);
  const pending = await storage.readPendingInbound(pendingKey);
  assert.deepEqual(pending.raw, raw);
  assert.equal(pending.metadata.from, "sender@example.test");
  assert.deepEqual(await storage.readRaw(saved.storageKey), raw);
  await storage.deleteRaw(saved.storageKey);
  await assert.rejects(readFile(join(localDir, saved.storageKey)), { code: "ENOENT" });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.ok(call);
  assert.match(call, new RegExp(`^GET /recovery/${pendingKey}`));
});
