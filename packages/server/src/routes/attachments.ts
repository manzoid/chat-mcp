import { Hono } from "hono";
import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { createHash } from "node:crypto";
import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@chat-mcp/shared";

export function attachmentRoutes(db: Database.Database, storagePath: string) {
  const app = new Hono();

  // Upload attachment to a room
  app.post("/rooms/:id/attachments", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const roomId = c.req.param("id");

    // Check membership
    const member = db
      .prepare(
        `SELECT 1 FROM room_members WHERE room_id = ? AND participant_id = ?`,
      )
      .get(roomId, participantId);

    if (!member) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    const formData = await c.req.parseBody();
    const file = formData["file"];

    if (!file || typeof file === "string") {
      return c.json(
        { error: { code: "invalid_request", message: "No file provided" } },
        400,
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: `File too large (max ${MAX_ATTACHMENT_SIZE_BYTES} bytes)`,
          },
        },
        400,
      );
    }

    const id = uuid();
    const filename = file.name || "unnamed";
    const mimeType = file.type || "application/octet-stream";
    const checksum = createHash("sha256").update(buffer).digest("hex");

    // Store on disk
    const dirPath = join(storagePath, id.slice(0, 2));
    await mkdir(dirPath, { recursive: true });
    const filePath = join(dirPath, id);
    await writeFile(filePath, buffer);

    db.prepare(
      `INSERT INTO attachments (id, filename, mime_type, size_bytes, storage_path, checksum, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, filename, mimeType, buffer.length, filePath, checksum, participantId);

    return c.json(
      {
        id,
        filename,
        mime_type: mimeType,
        size_bytes: buffer.length,
        checksum,
        uploaded_by: participantId,
        url: `/attachments/${id}`,
      },
      201,
    );
  });

  // Download attachment
  app.get("/attachments/:id", async (c) => {
    const id = c.req.param("id");
    const row = db
      .prepare(`SELECT * FROM attachments WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return c.json(
        { error: { code: "not_found", message: "Attachment not found" } },
        404,
      );
    }

    const data = await readFile(row.storage_path as string);
    return new Response(data, {
      headers: {
        "Content-Type": row.mime_type as string,
        "Content-Disposition": `attachment; filename="${row.filename}"`,
        "Content-Length": String(row.size_bytes),
      },
    });
  });

  // Get attachment metadata
  app.get("/attachments/:id/metadata", (c) => {
    const id = c.req.param("id");
    const row = db
      .prepare(
        `SELECT id, filename, mime_type, size_bytes, checksum, uploaded_by, created_at FROM attachments WHERE id = ?`,
      )
      .get(id);

    if (!row) {
      return c.json(
        { error: { code: "not_found", message: "Attachment not found" } },
        404,
      );
    }

    return c.json(row);
  });

  return app;
}
