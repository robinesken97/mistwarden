<!-- Added for Mistwarden on 2026-11-27. -->

# Mistwarden MCP server

Lets a coding assistant that speaks the Model Context Protocol (for example
Claude Code) build scenes in a Mistwarden campaign as its GM: maps from local
pictures or Universal VTT files, walls and doors, lights, tokens, fog, private
notes and gallery pictures. You give the assistant your own campaign notes
(Markdown) and map pictures on your computer; it reads them and sets the
scene up through this server.

It runs on your computer, over stdio, and talks to your Mistwarden instance
with your own session. It never sees your password.

## Setup

Node 24 or later.

```sh
cd mcp
npm ci
npm run login
```

`npm run login` asks for the instance address (for example
`https://mistwarden.example.org`), your email, your password (not echoed)
and, if the account has two-factor authentication, the six-digit code (a
backup code works too). It signs in with "remember me" and saves only the
session cookie and the address to `~/.config/mistwarden-mcp/session.json`,
readable by you alone (mode 0600). Set `MISTWARDEN_SESSION_FILE` to keep it
elsewhere. The session lasts 30 days without use and is renewed by every
request; when it has ended, the tools answer with a request to run
`npm run login` again (no restart of the server needed). Signing out everywhere in Mistwarden, or turning
two-factor authentication on or off, ends it too.

## Registering it in Claude Code

```sh
claude mcp add --scope user \
  --env MISTWARDEN_MCP_FILE_ROOT=/Users/you/Campaigns \
  --transport stdio mistwarden -- node /path/to/mistwarden/mcp/src/server.ts
```

Options go before the server name, the server command after `--`. Add
`--env MISTWARDEN_MCP_PLAYER_VISIBLE=1` only for a session where the
assistant may change what players see. `claude mcp list` shows whether it
connected. The same entry by hand, in a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "mistwarden": {
      "command": "node",
      "args": ["/path/to/mistwarden/mcp/src/server.ts"],
      "env": { "MISTWARDEN_MCP_FILE_ROOT": "/Users/you/Campaigns" }
    }
  }
}
```

## Switches

| Variable | Default | Effect |
|---|---|---|
| `MISTWARDEN_MCP_FILE_ROOT` | unset | The only folder the server reads files from (pictures, UVTT files, handouts). Required for every tool that reads a file. Symbolic links are followed and refused when they lead outside. |
| `MISTWARDEN_MCP_PLAYER_VISIBLE` | off | `1` registers the player-visible tools and allows changes to the map the players currently see. |
| `MISTWARDEN_MCP_ALLOW_ANY_EDIT` | off | `1` lets the update and delete tools touch objects this server did not create. |
| `MISTWARDEN_SESSION_FILE` | `~/.config/mistwarden-mcp/session.json` | Session file; the manifests sit in the same folder. |
| `MISTWARDEN_MCP_BACKUP_DIR` | `backups/` beside the session file | Where `create_backup` saves exports. |

## Safety model

- **GM campaigns only.** Every write tool first checks that the account is
  the GM of the campaign. The server checks it again on its side.
- **A manifest of what it created.** Each campaign gets a file
  `manifest-<campaign id>.json` beside the session file (mode 0600) with the
  ids of every map, token, wall, light, note, gallery picture, document and
  uploaded picture this server created, saved right after each create. Update
  and delete tools act only on those, unless
  `MISTWARDEN_MCP_ALLOW_ANY_EDIT=1`. Changing map settings and the fog count
  as updates: they need a map from the manifest. Adding walls, lights or
  tokens to one of your own maps is allowed; changing the ones already there
  is not.
- **Back up first.** `create_backup` downloads the campaign export (the same
  archive as Export in Mistwarden) to the backup folder. The gallery is not
  in that export: a picture shown only in the gallery is missing with its
  file, and a map picture keeps its file but not its gallery name, folder or
  sharing. The descriptions of
  the write tools ask the assistant to call it before a batch of changes. On
  the local test stack an export of a small campaign took about 0.01 s
  (220 KB with one 4096 px picture); it grows with the size of the pictures.
  The server allows only a few exports per hour, so call it once per batch,
  not before every change.
- **GM-only by default.** The tools that show something to the players at
  once (`set_current_map`, `show_gallery_picture`, `share_document`) are only
  registered with `MISTWARDEN_MCP_PLAYER_VISIBLE=1`. Without it, every change
  to the map the players currently see is refused too, since walls, lights,
  fog and visible tokens reach them immediately. New tokens are hidden, new
  gallery pictures unshown, notes private to their author.
- **Files from one folder.** Only files below `MISTWARDEN_MCP_FILE_ROOT` can
  be read.
- **No piled-up copies.** Creating a map, gallery picture or note whose name
  (any letter case) is already used in the campaign is refused unless the call
  passes `allowDuplicate: true`, so a build that is run again does not add a
  second set.
- **Rate limits respected.** The client reads the `RateLimit-Remaining` and
  `RateLimit-Reset` headers and pauses when fewer than 10 requests are left in a
  short window (the general budget of 300 a minute is per address and shared with your
  browser). After a 429 it waits for `Retry-After` and retries, up to four
  times; a wait longer than 45 s (the hourly export limit, say) is
  reported instead.

## Coordinates

Two frames, as in Mistwarden itself:

- **Map pixels** for walls, doors, lights and fog rectangles: origin at the
  top-left corner of the map, x to the right, y downward. The frame is
  `width × gridSize` by `height × gridSize` pixels; the map picture is
  stretched to fill it.
- **Grid cells** for tokens: whole squares, origin at the bottom-left, x to
  the right, y upward. A token's position is its bottom-left square. The token
  tools also take `origin: "top-left"`, where y is the row of the token's top
  square counted from the top, which is how one reads a picture; `get_map`
  gives each token's `topRow` as well. `gridOffsetX`/`gridOffsetY` move the
  squares, and the fog squares with them, from the map's corner.
- **Maps whose tokens do not snap** (`snapTokens` false, in `list_maps` and
  `get_map`, set with `update_map_settings`): a token's x and y may lie
  between squares, kept to hundredths. Where tokens snap, the token tools
  refuse a position between squares.
- **Hex maps** (`gridType` `hexPointy` or `hexFlat`, in `list_maps` and
  `get_map`): a token's cell is a hex, x counted from the first column and y
  from the bottom row of hexes whose centres lie in the frame. `origin:
  "top-left"` is refused there, and `topRow` is null; fog stays in squares.

`create_map_from_image` takes the grid in pixels of the original picture
(`gridPx`) or as squares across (`squaresAcross`) and computes the map size
from the original picture. So when the picture divides evenly into squares,
map pixels are the picture's own pixels, and a wall can be placed at the
coordinates read off the source file, even if the server stored a smaller
copy. Light radii and darkvision are in squares.

## Tools

Read: `list_campaigns`, `get_campaign`, `list_maps`, `get_map`, `list_notes`,
`get_note`, `list_gallery`.
Maps: `create_map_from_image`, `import_uvtt`, `update_map_settings`, `delete_map`.
Tokens: `add_token`, `update_token`, `delete_token`.
Walls and lights: `add_walls`, `update_wall` (type only), `delete_walls`,
`add_light`, `update_light`, `delete_light`.
Fog: `fog_reveal_rect`, `fog_hide_rect`, `fog_reveal_all`, `fog_hide_all`.
Notes: `create_note`, `update_note`. Gallery: `add_gallery_picture`.
Backup: `create_backup`.
Player-visible, with the switch: `set_current_map`, `show_gallery_picture`,
`share_document`.

Chat messages go over the live connection only (no REST route), so there is no
chat tool.

## Example

> Read `Mistvale/chapter-2.md` and `Mistvale/maps/crypt.jpg` (squares are
> 140 px). In the campaign "Mistvale", back it up, then create the map
> "Mistvale Crypt", walls along the room outlines with the doors the chapter
> mentions (the iron door is locked), a torch light by each brazier, and a
> hidden token for each creature in area 3, using the pictures in
> `Mistvale/tokens/`. Put the read-aloud boxes and the description of Oswin
> the gravekeeper into one note each. Turn fog on, with only the entrance
> hall revealed. Do not show anything to the players.

The assistant answers with what it created; open the map in Mistwarden as GM
to check it before the session.

## Limits

- **No undo.** Mistwarden has no server-side undo. Restore from a backup if a
  build went wrong; deleting is possible only for what this server created.
- **Rate limits** per address: 300 requests a minute in general, 30 uploads a
  minute, a few exports an hour.
- **Pictures** larger than 4096 px on a side are shrunk by the server when
  stored; the map keeps the grid of the original. 1 to 500 squares a side,
  10 to 500 pixels a square, 5,000 walls, 200 lights and 1,000 tokens a map,
  200 notes a campaign.
- **Uploaded token pictures** are campaign pictures, like those uploaded in
  Mistwarden itself.
- A JPEG's EXIF rotation is not read: a picture stored sideways is measured as
  stored.

## Tests

```sh
npm run lint && npm run typecheck && npm test
```

`npm run test:integration` builds a small synthetic scene on a running
instance through a real MCP client and checks it over REST, including a
sign-in with a two-factor code through `npm run login`. It turns two-factor
authentication on for the account it uses, so point it at a throwaway
instance only: `MCP_IT_BASE_URL` plus either `MCP_IT_SETUP_TOKEN` (a fresh
instance) or `MCP_IT_EMAIL` and `MCP_IT_PASSWORD` (an admin without two-factor
authentication).
