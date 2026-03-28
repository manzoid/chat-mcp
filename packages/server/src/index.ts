import { createDatabase } from "./db/connection.js";
import { createApp } from "./app.js";

const port = parseInt(process.env.PORT || "8080");
const dbPath = process.env.DB_PATH || "./chat.db";

const db = createDatabase(dbPath);
const { app } = createApp(db);

console.log(`Chat MCP server starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
