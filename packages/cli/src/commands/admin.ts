import { Command } from "commander";
import { loadConfig } from "../config.js";
import { ApiClient } from "../api.js";

export const adminCommand = new Command("admin")
  .description("Admin commands (requires admin role)");

adminCommand
  .command("invite")
  .description("Create an invite link")
  .requiredOption("--room <id>", "Room to invite to")
  .option("--expires <hours>", "Expiry in hours")
  .action(async (opts) => {
    const config = loadConfig();
    const api = new ApiClient(config);

    const body: Record<string, unknown> = { room_ids: [opts.room] };
    if (opts.expires) body.expires_in_hours = parseInt(opts.expires);

    const result = await api.post("/admin/invites", body);
    const baseUrl = config.server_url.replace(/\/$/, "");
    console.log(`Invite: ${baseUrl}/invite/${result.id}`);
    if (result.expires_at) {
      console.log(`Expires: ${result.expires_at}`);
    }
  });

adminCommand
  .command("invites")
  .description("List invites")
  .action(async () => {
    const config = loadConfig();
    const api = new ApiClient(config);
    const result = await api.get("/admin/invites");
    for (const inv of result.items) {
      const status = inv.used_by ? `used by ${inv.used_by}` : "available";
      const expires = inv.expires_at ? ` (expires ${inv.expires_at})` : "";
      console.log(`  ${inv.id.slice(0, 8)}  ${status}${expires}`);
    }
  });

adminCommand
  .command("participants")
  .description("List all participants")
  .action(async () => {
    const config = loadConfig();
    const api = new ApiClient(config);
    const result = await api.get("/admin/participants");
    for (const p of result.items) {
      const role = p.role !== "user" ? ` [${p.role}]` : "";
      console.log(`  ${p.display_name} (${p.type})${role}  ${p.id.slice(0, 8)}`);
    }
  });

adminCommand
  .command("promote")
  .description("Promote a user to admin")
  .argument("<participant-id>", "Participant ID")
  .action(async (id) => {
    const config = loadConfig();
    const api = new ApiClient(config);
    await api.post(`/admin/participants/${id}/role`, { role: "admin" });
    console.log(`Promoted ${id.slice(0, 8)} to admin`);
  });

adminCommand
  .command("demote")
  .description("Demote an admin to user")
  .argument("<participant-id>", "Participant ID")
  .action(async (id) => {
    const config = loadConfig();
    const api = new ApiClient(config);
    await api.post(`/admin/participants/${id}/role`, { role: "user" });
    console.log(`Demoted ${id.slice(0, 8)} to user`);
  });

adminCommand
  .command("remove")
  .description("Remove a participant")
  .argument("<participant-id>", "Participant ID")
  .action(async (id) => {
    const config = loadConfig();
    const api = new ApiClient(config);
    await api.delete(`/admin/participants/${id}`);
    console.log(`Removed ${id.slice(0, 8)}`);
  });

adminCommand
  .command("onboard")
  .description("Generate a setup command for a new teammate")
  .requiredOption("--name <name>", "Display name for the new user")
  .option("--room <id>", "Room to invite to (defaults to your default room)")
  .option("--expires <hours>", "Invite expiry in hours", "24")
  .action(async (opts) => {
    const config = loadConfig();
    const api = new ApiClient(config);

    const roomId = opts.room || config.default_room;
    if (!roomId) {
      console.error("No room specified and no default room in profile. Use --room <id>.");
      process.exit(1);
    }

    const body: Record<string, unknown> = { room_ids: [roomId] };
    if (opts.expires) body.expires_in_hours = parseInt(opts.expires);

    const result = await api.post("/admin/invites", body);
    const serverUrl = config.server_url.replace(/\/$/, "");

    console.log(`\nShare this with ${opts.name}:\n`);
    console.log(`  CHAT_PROFILE=${opts.name} chat init ${serverUrl} --invite ${result.id} --name ${opts.name}`);
    console.log(`\nInvite expires: ${result.expires_at || "never"}`);
  });
