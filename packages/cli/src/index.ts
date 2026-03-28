#!/usr/bin/env node
import { Command } from "commander";
import { authCommand } from "./commands/auth.js";
import { roomsCommand, createRoomCommand, joinCommand, whoCommand, topicCommand } from "./commands/rooms.js";
import { sendCommand } from "./commands/send.js";
import { readCommand } from "./commands/read.js";
import { watchCommand } from "./commands/watch.js";
import { reactCommand, unreactCommand } from "./commands/react.js";
import { editCommand } from "./commands/edit.js";
import { deleteCommand } from "./commands/delete.js";
import { pinCommand, unpinCommand, pinsCommand } from "./commands/pin.js";
import { searchCommand } from "./commands/search.js";

const program = new Command()
  .name("chat")
  .description("Chat MCP — collaborative messaging for human-agent workspaces")
  .version("0.1.0");

program.addCommand(authCommand);
program.addCommand(roomsCommand);
program.addCommand(createRoomCommand);
program.addCommand(joinCommand);
program.addCommand(whoCommand);
program.addCommand(topicCommand);
program.addCommand(sendCommand);
program.addCommand(readCommand);
program.addCommand(watchCommand);
program.addCommand(reactCommand);
program.addCommand(unreactCommand);
program.addCommand(editCommand);
program.addCommand(deleteCommand);
program.addCommand(pinCommand);
program.addCommand(unpinCommand);
program.addCommand(pinsCommand);
program.addCommand(searchCommand);

program.parseAsync(process.argv).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
