// Added for Mistwarden on 2026-11-27.
// The MCP server over stdio. stdout carries the protocol: log to stderr only.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readSession, readSettings } from './config.ts';
import { Api } from './http.ts';
import { registerTools } from './tools.ts';

const settings = readSettings();
// Read at start: a missing session stops the server with the login hint.
const session = await readSession(settings.sessionFile).catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});

const server = new McpServer(
  { name: 'mistwarden', version: '1.0.0' },
  {
    instructions:
      'Builds scenes in a self-hosted Mistwarden campaign as its GM. Everything is GM-only unless the player-visible switch is on. ' +
      'Call create_backup before a batch of changes: there is no undo. Walls, lights and fog use map pixels (top-left origin); tokens use grid cells (bottom-left origin).',
  },
);
const tools = registerTools(server, { api: new Api(session), settings });
await server.connect(new StdioServerTransport());
process.stderr.write(
  `mistwarden-mcp: ${tools.length} tools for ${session.baseUrl}; player-visible ${settings.playerVisible ? 'ON' : 'off'}, ` +
    `edit any ${settings.allowAnyEdit ? 'ON' : 'off'}, file root ${settings.fileRoot ?? 'not set'}\n`,
);
