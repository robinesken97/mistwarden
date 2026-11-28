<!-- Added for Mistwarden on 2026-11-27. -->

# Mistwarden MCP server

Lets a coding assistant that speaks the Model Context Protocol (for example
Claude Code) build scenes in a Mistwarden campaign as its GM: maps from local
pictures or Universal VTT files, walls and doors, lights, tokens, creatures,
fog, spell areas, private notes and gallery pictures. You give the assistant
your own campaign notes (Markdown) and map pictures on your computer; it reads
them and sets the scene up through this server. With the co-GM switch it also
helps run the game: hit points and conditions, initiative, doors, chat,
dice and the session.

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
`--env MISTWARDEN_MCP_COGM=1` for a session where the assistant helps run
the game, `--env MISTWARDEN_MCP_PLAYER_VISIBLE=1` only where it may also
change what players see in every other way (see the table below). `claude mcp list` shows whether it
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
| `MISTWARDEN_MCP_COGM` | off | `1`, co-GM mode: game state of anything in the campaign, also on the map the players see, and the table tools. |
| `MISTWARDEN_MCP_PLAYER_VISIBLE` | off | `1` registers the player-visible and table tools and allows any change to the map the players currently see. |
| `MISTWARDEN_MCP_ALLOW_ANY_EDIT` | off | `1` lets the update and delete tools touch objects this server did not create. |
| `MISTWARDEN_MCP_BACKUP_MAX_AGE_HOURS` | `6` | How recent a `create_backup` of the campaign must be before a delete tool runs. |
| `MISTWARDEN_SESSION_FILE` | `~/.config/mistwarden-mcp/session.json` | Session file; the manifests sit in the same folder. |
| `MISTWARDEN_MCP_BACKUP_DIR` | `backups/` beside the session file | Where `create_backup` saves exports. |

### What each mode allows

"Game state" is what changes while playing: a token's position, hit points,
conditions, initiative, facing, whether it is visible, its carried light on
or off; a door opened, closed or locked; a light on or off; fog; spell
areas; explored areas reset. "Edit" is everything else: names, sizes,
pictures, stat blocks, wall geometry, map settings, and every delete.
"Table" is what everyone at the table sees without a map: chat, whispers,
public rolls, initiative, the time of day, atmosphere, campaign settings and
the session.

| | no switch | `COGM=1` | `PLAYER_VISIBLE=1` | `ALLOW_ANY_EDIT=1` |
|---|---|---|---|---|
| Read anything, secret rolls | yes | yes | yes | yes |
| Create maps, tokens, walls, lights, notes, areas | yes, not on the map players see | also tokens and areas on that map | also on that map | – |
| Game state of what this server created | yes, not on the map players see | also on that map | also on that map | – |
| Game state of anything else | no | yes, also on the map players see | no | yes, not on the map players see |
| Edit or delete what this server created | yes, not on the map players see | same | also on that map | – |
| Edit or delete anything else | no | no | no | yes |
| Table tools (registered) | no | yes | yes | no |
| Player-visible tools (`set_current_map`, `show_gallery_picture`, `share_document`) | no | no | yes | no |
| Change a character sheet | no | yes | no | yes |
| Clear every area of a map | no | yes | no | yes |

The switches add up: `COGM=1` with `ALLOW_ANY_EDIT=1` lets edits reach
anything, but on the map the players see only with `PLAYER_VISIBLE=1` too.
Every delete also needs a recent backup (below), whatever the switches.

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
- **Co-GM mode.** `MISTWARDEN_MCP_COGM=1` lets the game-state tools act on
  everything in the campaign, as a second GM at the table would, but
  renaming, resizing, replacing and deleting stay bound to the manifest. A
  token update that mixes game state with any other field is refused whole.
  A wall becomes game state only between door types (`door-closed`,
  `door-open`, `door-locked`); turning a wall into a door is an edit.
- **Back up first, enforced for deletes.** `delete_map`, `delete_token`,
  `delete_walls` and `delete_light` refuse unless `create_backup` succeeded
  for that campaign within the last `MISTWARDEN_MCP_BACKUP_MAX_AGE_HOURS`
  (default 6); the time is kept in the manifest. Game-state changes need no
  backup. `create_backup` downloads the campaign export (the same
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
  registered with `MISTWARDEN_MCP_PLAYER_VISIBLE=1`, the table tools (chat,
  public rolls, initiative, time of day, session) with it or with
  `MISTWARDEN_MCP_COGM=1`. Without either, every change to the map the
  players currently see is refused too, since walls, lights, fog and visible
  tokens reach them immediately. New tokens are hidden, new gallery pictures
  unshown, notes private to their author, secret rolls the GM's alone.
- **Files from one folder.** Only files below `MISTWARDEN_MCP_FILE_ROOT` can
  be read. `list_files`, `search_files` and `read_file` check each entry by
  its real path, skip hidden files and folders (and links into them), read
  text only from `.md`, `.txt`, `.json` and `.csv` files, and bound what they
  answer: 500 entries, 50 search hits of 3 lines each, 100,000 characters per
  read (page on with `nextOffset`).
- **Instance data.** `import_creatures_markdown` and `import_spells_markdown`
  write to the instance's library, which every campaign of the instance sees,
  and need a platform admin. They read a Markdown file under the file root and
  are dry runs unless the call passes `dryRun: false`. `create_backup` does
  not cover them: the way back is `delete_imported_creatures` /
  `delete_imported_spells` for the same source tag, which need `confirm: true`.
- **Bounded calls.** One tool call makes at most 100 requests to Mistwarden
  (`update_tokens` takes up to 90 changes, `delete_walls` up to 95 ids), and
  reads the campaign and the map once.
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

Read: `list_campaigns`, `get_campaign`, `list_maps`, `get_map`,
`get_map_summary`, `list_tokens`, `list_notes`, `get_note`, `list_gallery`,
`get_messages`, `get_dice_rolls`, `get_initiative`, `list_sessions`,
`list_characters`, `get_character`.
Maps: `create_map_from_image`, `import_uvtt`, `update_map_settings` (also
grid type, offsets, size), `delete_map`.
Tokens: `add_token`, `update_token` (also hit points, conditions, initiative,
light, rotation, layer, display mode, picture, creature, character),
`update_tokens` (batch), `delete_token`.
Creatures and spells: `search_creatures`, `get_creature`, `place_creature`,
`list_spells`, `get_spell`.
Spell areas: `place_area`, `place_spell_area` (the spell's area as the server
stores it, or shape and size given), `list_areas`, `remove_area`,
`clear_areas`. Exploration: `reset_exploration`.
Walls and lights: `add_walls`, `update_wall` (type only), `delete_walls`,
`add_light`, `update_light`, `delete_light`.
Fog: `fog_reveal_rect`, `fog_hide_rect`, `fog_reveal_all`, `fog_hide_all`.
Notes: `create_note`, `update_note`. Gallery: `add_gallery_picture`.
Characters: `update_character` (co-GM or edit-any).
Dice: `roll_dice` (a secret roll needs no switch).
Local files: `list_files`, `search_files`, `read_file`.
Instance library (platform admins): `import_creatures_markdown`,
`import_spells_markdown`, `delete_imported_creatures`,
`delete_imported_spells`, `match_token_pictures`.
Backup: `create_backup`.
Table, with co-GM or player-visible: `send_chat`, `send_whisper`,
`start_combat`, `next_turn`, `end_combat`, `add_to_initiative`,
`roll_initiative`, `remove_from_initiative`, `set_initiative`,
`set_initiative_order`, `set_vibe`, `set_atmosphere`, `update_campaign` (name,
description, status, drawing, chat cooldown, vibe settings only),
`start_session`, `pause_session`, `resume_session`, `end_session`,
`set_session_notes`.
Player-visible, with that switch: `set_current_map`, `show_gallery_picture`,
`share_document`.

Not offered, on purpose: accounts, sign-in, users, administration and setup,
deleting a campaign, handing over the GM seat, removing members, changing
roles, importing a campaign.

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
sign-in with a two-factor code through `npm run login`, then runs the game in
co-GM mode: a player account it creates joins, an imported creature is placed
and an initiative round played, chat, a whisper and a secret roll are checked
from the player's side, a spell area is placed and removed, and a session
started, paused, resumed and ended. It turns two-factor authentication on for
the account it uses (a platform admin), creates a user and imports into the
instance library (deleted again at the end), so point it at a throwaway
instance only: `MCP_IT_BASE_URL` plus either `MCP_IT_SETUP_TOKEN` (a fresh
instance) or `MCP_IT_EMAIL` and `MCP_IT_PASSWORD` (an admin without two-factor
authentication).
