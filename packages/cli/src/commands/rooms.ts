import { Command } from "commander";
import { loadConfig, saveConfig } from "../config.js";
import { ApiClient } from "../api.js";

export const roomsCommand = new Command("rooms")
  .description("List rooms you belong to")
  .action(async () => {
    const config = loadConfig();
    const api = new ApiClient(config);
    const result = await api.get("/rooms");

    if (result.items.length === 0) {
      console.log("No rooms. Create one with: chat create-room <name>");
      return;
    }

    for (const room of result.items) {
      const marker = room.id === config.default_room ? " *" : "";
      console.log(`  ${room.name} (${room.id})${marker}`);
    }
  });

export const createRoomCommand = new Command("create-room")
  .description("Create a new room")
  .argument("<name>", "Room name")
  .option("--invite <ids...>", "Participant IDs to invite")
  .action(async (name, opts) => {
    const config = loadConfig();
    const api = new ApiClient(config);
    const result = await api.post("/rooms", {
      name,
      participants: opts.invite,
    });

    // Auto-set as default room if it's the first one
    if (!config.default_room) {
      config.default_room = result.id;
      saveConfig(config);
    }

    console.log(`Created room "${name}" (${result.id})`);
  });

export const joinCommand = new Command("join")
  .description("Set the active room")
  .argument("<name-or-id>", "Room name or ID")
  .action(async (nameOrId) => {
    const config = loadConfig();
    const api = new ApiClient(config);
    const result = await api.get("/rooms");

    const room = result.items.find(
      (r: any) => r.id === nameOrId || r.name === nameOrId || r.name === nameOrId.replace(/^#/, ""),
    );

    if (!room) {
      console.error(`Room not found: ${nameOrId}`);
      process.exit(1);
    }

    config.default_room = room.id;
    saveConfig(config);
    console.log(`Switched to #${room.name}`);
  });

export const whoCommand = new Command("who")
  .description("List participants in the current room")
  .action(async () => {
    const config = loadConfig();
    if (!config.default_room) {
      console.error("No room selected. Run: chat join <room>");
      process.exit(1);
    }

    const api = new ApiClient(config);
    const result = await api.get(`/rooms/${config.default_room}/participants`);

    for (const p of result.items) {
      const tag = p.type === "agent" ? " [agent]" : "";
      console.log(`  ${p.display_name}${tag}`);
    }
  });

export const topicCommand = new Command("topic")
  .description("Set the room topic")
  .argument("<text>", "Topic text")
  .action(async (text) => {
    const config = loadConfig();
    if (!config.default_room) {
      console.error("No room selected. Run: chat join <room>");
      process.exit(1);
    }

    const api = new ApiClient(config);
    await api.patch(`/rooms/${config.default_room}`, { topic: text });
    console.log(`Topic set: ${text}`);
  });
