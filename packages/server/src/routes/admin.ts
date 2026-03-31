import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { AuthService } from "../services/auth.js";

export function adminRoutes(db: Database.Database, authService: AuthService) {
  const app = new Hono();

  // All admin routes require admin or super role
  function requireAdmin(c: any): string | null {
    const participantId = c.get("participantId" as never) as string;
    if (!authService.isAdmin(participantId)) {
      c.status(403);
      return null;
    }
    return participantId;
  }

  // Create invite link
  app.post("/invites", async (c) => {
    const adminId = requireAdmin(c);
    if (!adminId) {
      return c.json(
        { error: { code: "forbidden", message: "Admin access required" } },
        403,
      );
    }

    const body = await c.req.json();
    const { room_ids, expires_in_hours } = body;

    if (!room_ids || !Array.isArray(room_ids) || room_ids.length === 0) {
      return c.json(
        { error: { code: "invalid_request", message: "room_ids required" } },
        400,
      );
    }

    // Validate rooms exist
    for (const roomId of room_ids) {
      const room = db
        .prepare(`SELECT id FROM rooms WHERE id = ?`)
        .get(roomId);
      if (!room) {
        return c.json(
          { error: { code: "not_found", message: `Room ${roomId} not found` } },
          404,
        );
      }
    }

    const expiresAt = expires_in_hours
      ? new Date(Date.now() + expires_in_hours * 60 * 60 * 1000).toISOString()
      : undefined;

    const inviteId = authService.createInvite(adminId, room_ids, expiresAt);

    return c.json(
      {
        id: inviteId,
        url: `/invite/${inviteId}`,
        room_ids,
        expires_at: expiresAt ?? null,
        created_by: adminId,
      },
      201,
    );
  });

  // List invites
  app.get("/invites", (c) => {
    const adminId = requireAdmin(c);
    if (!adminId) {
      return c.json(
        { error: { code: "forbidden", message: "Admin access required" } },
        403,
      );
    }

    const invites = authService.getInvites();
    return c.json({ items: invites });
  });

  // Revoke unused invite
  app.delete("/invites/:id", (c) => {
    const adminId = requireAdmin(c);
    if (!adminId) {
      return c.json(
        { error: { code: "forbidden", message: "Admin access required" } },
        403,
      );
    }

    const deleted = authService.deleteInvite(c.req.param("id"));
    if (!deleted) {
      return c.json(
        { error: { code: "not_found", message: "Invite not found or already used" } },
        404,
      );
    }
    return c.body(null, 204);
  });

  // List all participants
  app.get("/participants", (c) => {
    const adminId = requireAdmin(c);
    if (!adminId) {
      return c.json(
        { error: { code: "forbidden", message: "Admin access required" } },
        403,
      );
    }

    const participants = db
      .prepare(`SELECT id, display_name, type, role, paired_with, created_at FROM participants ORDER BY created_at`)
      .all();
    return c.json({ items: participants });
  });

  // Set participant role (super only for admin promotion)
  app.post("/participants/:id/role", async (c) => {
    const actorId = c.get("participantId" as never) as string;
    const actorRole = authService.getParticipantRole(actorId);
    const targetId = c.req.param("id");

    const body = await c.req.json();
    const { role } = body;

    if (!role || !["admin", "user"].includes(role)) {
      return c.json(
        { error: { code: "invalid_request", message: "role must be 'admin' or 'user'" } },
        400,
      );
    }

    // Only super can set admin role
    if (role === "admin" && actorRole !== "super") {
      return c.json(
        { error: { code: "forbidden", message: "Only super admin can promote to admin" } },
        403,
      );
    }

    // Only super can demote admins
    const targetRole = authService.getParticipantRole(targetId);
    if (targetRole === "admin" && actorRole !== "super") {
      return c.json(
        { error: { code: "forbidden", message: "Only super admin can demote admins" } },
        403,
      );
    }

    // Can't change super role
    if (targetRole === "super") {
      return c.json(
        { error: { code: "forbidden", message: "Cannot change super admin role" } },
        403,
      );
    }

    if (role === "admin") {
      authService.promoteToAdmin(targetId);
    } else {
      authService.demoteToUser(targetId);
    }

    return c.json({ ok: true, role });
  });

  // Update participant (e.g. set paired_with)
  app.patch("/participants/:id", async (c) => {
    const adminId = requireAdmin(c);
    if (!adminId) {
      return c.json(
        { error: { code: "forbidden", message: "Admin access required" } },
        403,
      );
    }

    const targetId = c.req.param("id");
    const body = await c.req.json();

    if (body.paired_with !== undefined) {
      db.prepare(`UPDATE participants SET paired_with = ? WHERE id = ?`)
        .run(body.paired_with, targetId);
    }

    return c.json({ ok: true });
  });

  // Delete participant
  app.delete("/participants/:id", (c) => {
    const actorId = c.get("participantId" as never) as string;
    const actorRole = authService.getParticipantRole(actorId);
    const targetId = c.req.param("id");

    if (actorId === targetId) {
      return c.json(
        { error: { code: "forbidden", message: "Cannot delete yourself" } },
        403,
      );
    }

    const targetRole = authService.getParticipantRole(targetId);

    // Admins can't delete other admins or super
    if (actorRole === "admin" && (targetRole === "admin" || targetRole === "super")) {
      return c.json(
        { error: { code: "forbidden", message: "Admins cannot delete other admins" } },
        403,
      );
    }

    // Only admin or super can delete
    if (!authService.isAdmin(actorId)) {
      return c.json(
        { error: { code: "forbidden", message: "Admin access required" } },
        403,
      );
    }

    authService.deleteParticipant(targetId);
    return c.body(null, 204);
  });

  return app;
}
