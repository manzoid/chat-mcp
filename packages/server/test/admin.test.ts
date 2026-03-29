import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sign } from "@chat-mcp/shared";
import {
  createTestApp,
  generateTestKeys,
  registerAndAuth,
  authedReq,
  sendSignedMessage,
  type TestApp,
  type TestUser,
} from "./helpers.js";

let tmpDir: string;
let testApp: TestApp;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "chat-mcp-admin-"));
  testApp = await createTestApp(tmpDir);
});

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("super admin bootstrap", () => {
  it("creates a super admin on startup", () => {
    const row = testApp.db
      .prepare(`SELECT role FROM participants WHERE id = ?`)
      .get(testApp.adminUser.participantId) as { role: string };
    expect(row.role).toBe("super");
  });

  it("is idempotent — second bootstrap returns same ID", async () => {
    const { AuthService } = await import("../src/services/auth.js");
    const authService = new AuthService(testApp.db);
    const id = await authService.bootstrapSuperAdmin(testApp.adminUser.publicKey);
    expect(id).toBe(testApp.adminUser.participantId);
  });
});

describe("invite flow", () => {
  let roomId: string;

  beforeAll(async () => {
    // Admin creates a room
    const res = await authedReq(testApp.app, testApp.adminUser.sessionToken, "/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "invite-test-room" }),
    });
    roomId = (await res.json()).id;
  });

  it("admin creates invite link", async () => {
    const res = await authedReq(testApp.app, testApp.adminUser.sessionToken, "/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_ids: [roomId] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.url).toContain("/invite/");
  });

  it("new user registers via invite", async () => {
    // Create invite
    const invRes = await authedReq(testApp.app, testApp.adminUser.sessionToken, "/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_ids: [roomId] }),
    });
    const invite = await invRes.json();

    // Register via invite
    const newKeys = generateTestKeys(tmpDir, "invite-user");
    const regRes = await testApp.app.request(`http://localhost/auth/invite/${invite.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: "invited-user",
        public_key: newKeys.publicKey,
      }),
    });
    expect(regRes.status).toBe(201);
    const body = await regRes.json();
    expect(body.participant_id).toBeTruthy();
    expect(body.rooms_joined).toContain(roomId);

    // Verify they can send messages in the room
    const chalRes = await testApp.app.request("http://localhost/auth/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: body.participant_id }),
    });
    const { challenge } = await chalRes.json();
    const sig = await sign(newKeys.keyPath, { challenge });
    const verRes = await testApp.app.request("http://localhost/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: body.participant_id, signed_challenge: sig }),
    });
    const { session_token } = await verRes.json();

    const msgRes = await authedReq(testApp.app, session_token, `/rooms/${roomId}/messages`);
    expect(msgRes.status).toBe(200);
  });

  it("rejects expired invites", async () => {
    // Create invite that already expired
    const { AuthService } = await import("../src/services/auth.js");
    const authService = new AuthService(testApp.db);
    const expiredId = authService.createInvite(
      testApp.adminUser.participantId,
      [roomId],
      new Date(Date.now() - 1000).toISOString(), // expired 1 second ago
    );

    const newKeys = generateTestKeys(tmpDir, "expired-invite-user");
    const res = await testApp.app.request(`http://localhost/auth/invite/${expiredId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: "expired-user",
        public_key: newKeys.publicKey,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invite_expired");
  });

  it("rejects already-used invites", async () => {
    // Create and consume an invite
    const invRes = await authedReq(testApp.app, testApp.adminUser.sessionToken, "/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_ids: [roomId] }),
    });
    const invite = await invRes.json();

    const keys1 = generateTestKeys(tmpDir, "used-invite-1");
    await testApp.app.request(`http://localhost/auth/invite/${invite.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "first-use", public_key: keys1.publicKey }),
    });

    // Try to use the same invite again
    const keys2 = generateTestKeys(tmpDir, "used-invite-2");
    const res = await testApp.app.request(`http://localhost/auth/invite/${invite.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "second-use", public_key: keys2.publicKey }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invite_used");
  });

  it("rejects nonexistent invites", async () => {
    const keys = generateTestKeys(tmpDir, "bad-invite");
    const res = await testApp.app.request(`http://localhost/auth/invite/nonexistent-uuid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "nobody", public_key: keys.publicKey }),
    });
    expect(res.status).toBe(404);
  });
});

describe("role enforcement", () => {
  let regularUser: TestUser;
  let adminUser: TestUser;
  let roomId: string;

  beforeAll(async () => {
    // Create a regular user and an admin
    const regKeys = generateTestKeys(tmpDir, "regular");
    regularUser = await registerAndAuth(
      testApp.app,
      testApp.adminUser.sessionToken,
      "regular-user",
      regKeys.keyPath,
      regKeys.publicKey,
    );

    const admKeys = generateTestKeys(tmpDir, "promoted-admin");
    adminUser = await registerAndAuth(
      testApp.app,
      testApp.adminUser.sessionToken,
      "promoted-admin",
      admKeys.keyPath,
      admKeys.publicKey,
    );
    // Promote to admin
    await authedReq(testApp.app, testApp.adminUser.sessionToken, `/admin/participants/${adminUser.participantId}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });

    // Create a room
    const roomRes = await authedReq(testApp.app, testApp.adminUser.sessionToken, "/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "role-test-room" }),
    });
    roomId = (await roomRes.json()).id;
  });

  it("regular user cannot create rooms", async () => {
    const res = await authedReq(testApp.app, regularUser.sessionToken, "/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "unauthorized-room" }),
    });
    expect(res.status).toBe(403);
  });

  it("regular user cannot create invites", async () => {
    const res = await authedReq(testApp.app, regularUser.sessionToken, "/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_ids: [roomId] }),
    });
    expect(res.status).toBe(403);
  });

  it("regular user cannot register directly", async () => {
    const keys = generateTestKeys(tmpDir, "sneaky");
    const res = await authedReq(testApp.app, regularUser.sessionToken, "/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "sneaky", type: "human", public_key: keys.publicKey }),
    });
    expect(res.status).toBe(403);
  });

  it("admin can create invites", async () => {
    const res = await authedReq(testApp.app, adminUser.sessionToken, "/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_ids: [roomId] }),
    });
    expect(res.status).toBe(201);
  });

  it("admin cannot delete other admins", async () => {
    const res = await authedReq(testApp.app, adminUser.sessionToken, `/admin/participants/${testApp.adminUser.participantId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });

  it("super can delete admins", async () => {
    // Create a sacrificial admin
    const sacKeys = generateTestKeys(tmpDir, "sacrificial");
    const sac = await registerAndAuth(
      testApp.app,
      testApp.adminUser.sessionToken,
      "sacrificial-admin",
      sacKeys.keyPath,
      sacKeys.publicKey,
    );
    testApp.db.prepare(`UPDATE participants SET role = 'admin' WHERE id = ?`).run(sac.participantId);

    const res = await authedReq(testApp.app, testApp.adminUser.sessionToken, `/admin/participants/${sac.participantId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });

  it("admin cannot promote to admin (only super can)", async () => {
    const res = await authedReq(testApp.app, adminUser.sessionToken, `/admin/participants/${regularUser.participantId}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("self-service", () => {
  let user: TestUser;

  beforeAll(async () => {
    const keys = generateTestKeys(tmpDir, "selfserve");
    user = await registerAndAuth(
      testApp.app,
      testApp.adminUser.sessionToken,
      "selfserve-user",
      keys.keyPath,
      keys.publicKey,
    );
  });

  it("user can change own display name", async () => {
    const res = await authedReq(testApp.app, user.sessionToken, "/participants/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "new-name" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.display_name).toBe("new-name");
  });

  it("rejects duplicate display name", async () => {
    // Try to take the super admin's name
    const res = await authedReq(testApp.app, user.sessionToken, "/participants/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: testApp.adminUser.displayName }),
    });
    expect(res.status).toBe(400);
  });
});
