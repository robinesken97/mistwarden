// Added for Mistwarden on 2026-11-27.
/**
 * A table of a GM and four players, each in a browser of their own: two in
 * WebKit as iPads, two in Chromium. What one does reaches the others live,
 * a player who drops off and comes back gets what they missed, and a picture
 * the GM shows to two of them opens for those two alone.
 *
 * Runs in the desktop project only (it opens its own browsers). Accounts are
 * made through the admin API, so it needs no mail server.
 */

import { test, expect, webkit, devices, type Browser, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test';
import { ADMIN, BASE_URL } from './instance';

const PLAYER_PASSWORD = 'Table-Test-Passw0rd!';

/** What each page's live connection has received, as text. */
const frames = new Map<Page, string[]>();
function listen(page: Page): Page {
  const got: string[] = [];
  frames.set(page, got);
  page.on('websocket', (ws) => ws.on('framereceived', ({ payload }) => { got.push(String(payload)); }));
  return page;
}

interface Seat {
  name: string;
  context: BrowserContext;
  page: Page;
  userId: string;
}

async function signInRequest(request: APIRequestContext, email: string, password: string): Promise<void> {
  const res = await request.post('/api/auth/login', { data: { email, password } });
  expect(res.status(), `sign in ${email}`).toBe(200);
}

/** A new account with its own password, made by the admin. */
async function makePlayer(admin: APIRequestContext, context: BrowserContext, name: string): Promise<string> {
  const email = `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}@example.com`;
  const made = await admin.post('/api/admin/users', { data: { email, displayName: name, platformRole: 'USER' } });
  expect(made.status(), await made.text()).toBe(201);
  const { user, temporaryPassword } = (await made.json()) as { user: { id: string }; temporaryPassword?: string };
  expect(temporaryPassword, 'the instance mailed the password instead of answering it').toBeTruthy();
  await signInRequest(context.request, email, temporaryPassword!);
  const changed = await context.request.post('/api/auth/change-password', {
    data: { currentPassword: temporaryPassword, newPassword: PLAYER_PASSWORD },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  await signInRequest(context.request, email, PLAYER_PASSWORD);
  return user.id;
}

/** The session rail's tab, or on a compact layout nothing (this test uses desktop and iPad landscape). */
const openTab = (page: Page, name: string) => page.getByRole('tab', { name }).click();

test('a GM and four players share one table', async ({ browser, playwright }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Opens its own browsers; once is enough.');
  test.setTimeout(240_000);

  const admin = await playwright.request.newContext({ baseURL: BASE_URL });
  await signInRequest(admin, ADMIN.email, ADMIN.password);

  // The GM: the admin, in this project's Chromium.
  const gmContext = await browser.newContext({ baseURL: BASE_URL });
  await signInRequest(gmContext.request, ADMIN.email, ADMIN.password);
  const created = await gmContext.request.post('/api/campaigns', { data: { name: `Table of five ${Date.now()}` } });
  expect(created.status()).toBe(201);
  const campaignId = ((await created.json()) as { campaign?: { id: string }; id?: string }).campaign?.id
    ?? ((await created.json()) as { id: string }).id;

  // Four players: two iPads in WebKit, two desktops in Chromium.
  const safari: Browser = await webkit.launch();
  const seats: Seat[] = [];
  for (const [i, name] of ['Ada', 'Bo', 'Cy', 'Di'].entries()) {
    const context = i < 2
      ? await safari.newContext({ ...devices['iPad Pro 11 landscape'], baseURL: BASE_URL })
      : await browser.newContext({ baseURL: BASE_URL });
    const userId = await makePlayer(admin, context, name);
    const invite = await gmContext.request.post(`/api/campaigns/${campaignId}/invite`, { data: { userId } });
    expect(invite.status(), await invite.text()).toBe(201);
    const invitations = (await (await context.request.get('/api/invitations')).json()) as Array<{ id: string; campaignId: string }>;
    const invitation = invitations.find((inv) => inv.campaignId === campaignId);
    expect(invitation, 'the invitation reached the player').toBeTruthy();
    const accepted = await context.request.post(`/api/invitations/${invitation!.id}/accept`, { data: {} });
    expect(accepted.status(), await accepted.text()).toBe(200);
    seats.push({ name, context, page: listen(await context.newPage()), userId });
  }

  // Everyone sits down at the table, each with a live connection.
  const gm = listen(await gmContext.newPage());
  for (const page of [gm, ...seats.map((s) => s.page)]) {
    await page.goto(`/campaigns/${campaignId}`);
    await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible({ timeout: 30_000 });
  }

  /** A 2x2 PNG uploaded as a picture of the campaign from the GM's page, as the app does. */
  const upload = (file: string) => gm.evaluate(async ({ id, file }) => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR42mNk+M9Qz8DAwMDEwMDAAAAWgQIB2zRdPwAAAABJRU5ErkJggg==';
    const form = new FormData();
    form.append('type', 'MAP');
    form.append('scope', 'CAMPAIGN');
    form.append('campaignId', id);
    form.append('name', file);
    form.append('file', new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], file, { type: 'image/png' }));
    const res = await fetch('/api/assets/upload', { method: 'POST', body: form, credentials: 'include' });
    if (res.status !== 201) throw new Error(`upload answered ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { asset: { id: string } }).asset.id;
  }, { id: campaignId, file });

  const say = async (page: Page, text: string) => {
    await openTab(page, 'Chat');
    await page.getByRole('textbox', { name: 'Chat message' }).fill(text);
    await page.getByRole('button', { name: 'Send message' }).click();
  };
  const hears = async (page: Page, text: string) => {
    await openTab(page, 'Chat');
    await expect(page.getByText(text)).toBeVisible({ timeout: 15_000 });
  };

  await test.step('chat from the GM reaches all four players', async () => {
    await say(gm, 'Welcome to the table');
    for (const seat of seats) await hears(seat.page, 'Welcome to the table');
  });

  await test.step('chat from an iPad reaches the GM and the other players', async () => {
    await say(seats[1].page, 'Bo is here');
    for (const page of [gm, seats[0].page, seats[2].page, seats[3].page]) await hears(page, 'Bo is here');
  });

  await test.step('a dice roll is seen by everyone', async () => {
    await openTab(seats[2].page, 'Dice');
    await seats[2].page.getByRole('textbox', { name: 'Dice expression' }).fill('1d20+5');
    await seats[2].page.getByRole('button', { name: /^Roll$/ }).click();
    for (const page of [gm, seats[0].page, seats[1].page, seats[3].page]) {
      await openTab(page, 'Dice');
      await expect(page.getByRole('log', { name: 'Dice rolls' }).getByText(/1d20\+5/)).toBeVisible({ timeout: 15_000 });
    }
  });

  await test.step('a player moves their own token and everyone at the table sees it move', async () => {
    const map = await gmContext.request.post(`/api/campaigns/${campaignId}/maps`, {
      data: { name: 'Crossroads', imageUrl: await upload('crossroads.png'), width: 12, height: 10, gridSize: 50 },
    });
    expect(map.status(), await map.text()).toBe(201);
    const mapId = ((await map.json()) as { map: { id: string } }).map.id;
    await gm.getByRole('button', { name: 'Map Library' }).click();
    await gm.getByRole('button', { name: 'Set Active' }).first().click();
    await gm.keyboard.press('Escape');
    // The table is on it once the campaign says so; only then may a player touch its tokens.
    await expect
      .poll(async () => ((await (await gmContext.request.get(`/api/campaigns/${campaignId}`)).json()) as { campaign?: { currentMapId?: string }; currentMapId?: string }).campaign?.currentMapId, { timeout: 15_000 })
      .toBe(mapId);

    const added = await gmContext.request.post(`/api/campaigns/${campaignId}/maps/${mapId}/tokens`, {
      data: {
        id: crypto.randomUUID(), name: 'Ada', imageUrl: '', position: { x: 3, y: 4 }, size: { width: 1, height: 1 },
        layer: 'token', visible: true, controlledBy: seats[0].userId, rotation: 0, conditions: [], metadata: {},
      },
    });
    expect(added.status(), await added.text()).toBe(201);
    const tokenId = ((await added.json()) as { token: { id: string } }).token.id;

    for (const page of frames.keys()) frames.get(page)!.length = 0;
    const moved = await seats[0].context.request.put(`/api/campaigns/${campaignId}/maps/${mapId}/tokens/${tokenId}`, {
      data: { position: { x: 8, y: 2 } },
    });
    expect(moved.status(), await moved.text()).toBe(200);
    // Each other seat is sent the map again with the token where Ada put it.
    for (const page of [gm, seats[1].page, seats[2].page, seats[3].page]) {
      await expect
        .poll(() => frames.get(page)!.some((f) => f.includes(tokenId) && /"position":\{"x":8,"y":2\}/.test(f)), { timeout: 15_000 })
        .toBe(true);
    }
  });

  await test.step('a player who drops off gets what they missed when they come back', async () => {
    const away = seats[3];
    await away.context.setOffline(true);
    await say(gm, 'Said while Di was away');
    await hears(seats[0].page, 'Said while Di was away');
    await away.context.setOffline(false);
    await away.page.reload();
    await openTab(away.page, 'Chat');
    await hears(away.page, 'Said while Di was away');
    await hears(away.page, 'Welcome to the table');
    // And is live again: what is said now arrives without another reload.
    await say(gm, 'Welcome back, Di');
    await hears(away.page, 'Welcome back, Di');
  });

  await test.step('a picture the GM shows to two players opens for those two alone', async () => {
    const assetId = await upload('letter.png');
    const filed = await gmContext.request.post(`/api/campaigns/${campaignId}/gallery`, { data: { assetId, name: 'The letter', folder: 'Act 1' } });
    expect(filed.status(), await filed.text()).toBe(201);
    const pictureId = ((await filed.json()) as { picture: { id: string } }).picture.id;

    const shown = await gmContext.request.patch(`/api/campaigns/${campaignId}/gallery/${pictureId}`, {
      data: { shownTo: [seats[0].userId, seats[2].userId] },
    });
    expect(shown.status()).toBe(200);

    for (const seat of [seats[0], seats[2]]) {
      await expect(seat.page.getByRole('dialog', { name: 'The letter' })).toBeVisible({ timeout: 15_000 });
      expect((await seat.context.request.get(`/api/assets/maps/${assetId}`)).status()).toBe(200);
    }
    for (const seat of [seats[1], seats[3]]) {
      await expect(seat.page.getByRole('dialog', { name: 'The letter' })).toHaveCount(0);
      expect((await seat.context.request.get(`/api/assets/maps/${assetId}`)).status()).toBe(404);
    }

    // Hidden again: the open pictures close.
    await gmContext.request.patch(`/api/campaigns/${campaignId}/gallery/${pictureId}`, { data: { shownTo: [] } });
    for (const seat of [seats[0], seats[2]]) {
      await expect(seat.page.getByRole('dialog', { name: 'The letter' })).toHaveCount(0, { timeout: 15_000 });
    }
  });

  await safari.close();
  await gmContext.close();
  for (const seat of seats) await seat.context.close().catch(() => undefined);
  await admin.dispose();
});
