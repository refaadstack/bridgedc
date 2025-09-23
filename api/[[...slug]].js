// api/[[...slug]].js — single file, cuma API + catat log ke Discord (embed)
// NOTE: jarak title atur di Roblox, bukan di sini.

const {
  GUILD_ID,
  DISCORD_BOT_TOKEN,
  DISCORD_LOG_WEBHOOK_URL,
  BLOXLINK_KEY,
  SHARED_SECRET,
} = process.env;

/* ---------- utils ---------- */
const NOW = () => Math.floor(Date.now() / 1000);
const send = (res, code, body, type = "application/json") => {
  res.statusCode = code;
  res.setHeader("Content-Type", type);
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};
const okSecret = (req, res) => {
  if (!SHARED_SECRET) return send(res, 500, { error: "SHARED_SECRET missing" });
  if (req.headers["x-game-secret"] !== SHARED_SECRET) return send(res, 401, { error: "unauthorized" });
  return true;
};
const parseBody = async (req) => {
  const b = [];
  for await (const c of req) b.push(c);
  return b.length ? JSON.parse(Buffer.concat(b).toString("utf8")) : {};
};

/* ---------- webhook embeds ---------- */
const sendEmbeds = async (embeds = []) => {
  if (!DISCORD_LOG_WEBHOOK_URL) return;
  await fetch(DISCORD_LOG_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds }),
  });
};
const COLORS = { blue: 0x2b88ff, green: 0x22cc66, red: 0xff3333, gray: 0x2f3136 };
const base = (title, color) => ({ title, color, timestamp: new Date().toISOString() });

const embedStatus = ({ online = 0, uptimeMin = "n/a" } = {}) => ({
  ...base("Server Status Update", COLORS.blue),
  fields: [
    { name: "Players Online", value: String(online), inline: true },
    { name: "Server Uptime", value: `${uptimeMin} minutes`, inline: true },
  ],
});
const embedJoin = ({ username = "-", userId = "-", displayName = "-", rolesTxt = "-", summitTitle = "-", summitCount = 0 } = {}) => ({
  ...base("Player Joined", COLORS.green),
  description: `${username} joined the server`,
  fields: [
    { name: "User ID", value: String(userId), inline: true },
    { name: "Display Name", value: String(displayName || "-"), inline: true },
    { name: "Roles", value: rolesTxt || "-", inline: false },
    { name: "Summit Title", value: String(summitTitle || "-"), inline: true },
    { name: "Summit Count", value: String(summitCount), inline: true },
  ],
});
const embedLeft = ({ username = "-", userId = "-", session = "Calculating...", rolesTxt = "-", summitTitle = "-", summitCount = 0 } = {}) => ({
  ...base("Player Left", COLORS.red),
  description: `${username} left the server`,
  fields: [
    { name: "User ID", value: String(userId), inline: true },
    { name: "Session Time", value: String(session), inline: true },
    { name: "Roles", value: rolesTxt || "-", inline: false },
    { name: "Summit Title", value: String(summitTitle || "-"), inline: true },
    { name: "Summit Count", value: String(summitCount), inline: true },
  ],
});
const embedGeneric = ({ type, playerName, playerId, data } = {}) => ({
  ...base(`[${String(type || "LOG").toUpperCase()}]`, COLORS.gray),
  description: `Player: ${playerName ?? "unknown"} (${playerId ?? "-"})`,
  fields: data ? [{ name: "Data", value: "```json\n" + JSON.stringify(data, null, 2) + "\n```" }] : undefined,
});

/* ---------- Discord + Bloxlink helpers ---------- */
const getGuildMember = async (id) => {
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${id}`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    if (!r.ok) return { error: true, status: r.status, statusText: r.statusText, details: await r.text() };
    return await r.json();
  } catch (e) {
    return { error: true, message: e.message };
  }
};
const getGuildRoles = async () => {
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
};
const resolveRoles = async (ids = []) => {
  const all = await getGuildRoles();
  if (!Array.isArray(all)) return [];
  const byId = Object.fromEntries(all.map((x) => [x.id, x]));
  return ids.map((id) => ({ id, name: byId[id]?.name || `Unknown Role (${id})` }));
};
async function bloxlinkRobloxToDiscord(robloxId) {
  try {
    const r1 = await fetch(`https://api.blox.link/v4/public/guilds/${GUILD_ID}/roblox-to-discord/${robloxId}`, {
      headers: { Authorization: BLOXLINK_KEY },
    });
    if (r1.ok) {
      const j = await r1.json();
      if (j?.discordId) return { discordId: j.discordId, source: "guild" };
      if (j?.primaryAccount?.discordId) return { discordId: j.primaryAccount.discordId, source: "guild" };
      if (j?.data?.primaryAccount?.discordId) return { discordId: j.data.primaryAccount.discordId, source: "guild" };
      if (Array.isArray(j?.discordIDs) && j.discordIDs.length) return { discordId: j.discordIDs[0], source: "guild" };
      if (Array.isArray(j?.data?.discordIDs) && j.data.discordIDs.length) return { discordId: j.data.discordIDs[0], source: "guild" };
    }
    const r2 = await fetch(`https://api.blox.link/v4/public/roblox-to-discord/${robloxId}`, {
      headers: { Authorization: BLOXLINK_KEY },
    });
    if (!r2.ok) return { discordId: null, source: "none", error: `HTTP ${r2.status}`, errorDetails: await r2.text() };
    const g = await r2.json();
    if (g?.discordId) return { discordId: g.discordId, source: "global" };
    if (g?.primaryAccount?.discordId) return { discordId: g.primaryAccount.discordId, source: "global" };
    if (g?.data?.primaryAccount?.discordId) return { discordId: g.data.primaryAccount.discordId, source: "global" };
    if (Array.isArray(g?.discordIDs) && g.discordIDs.length) return { discordId: g.discordIDs[0], source: "global" };
    if (Array.isArray(g?.data?.discordIDs) && g.data.discordIDs.length) return { discordId: g.data.discordIDs[0], source: "global" };
    return { discordId: null, source: "none", error: "No Discord ID found" };
  } catch (e) {
    return { discordId: null, source: "error", error: e.message };
  }
}
const getRoleNamesForRoblox = async (robloxId) => {
  const map = await bloxlinkRobloxToDiscord(robloxId);
  if (!map.discordId) return { verified: false, names: [] };
  const m = await getGuildMember(map.discordId);
  if (!m || m.error) return { verified: false, names: [] };
  const resolved = await resolveRoles(m.roles || []);
  return { verified: true, names: resolved.map((r) => r.name) };
};

/* ---------- router ---------- */
module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/^\/api/, "") || "/";

  // health
  if (req.method === "GET" && (path === "/" || path === "/health")) {
    if (url.searchParams.get("format") === "html") return send(res, 200, "<h1>Bridge OK</h1>", "text/html");
    return send(res, 200, { ok: true, timestamp: NOW() });
  }

  // POST /log → kirim embed rapi (Role + Summit Title + Summit Count)
  if (req.method === "POST" && path === "/log") {
    if (okSecret(req, res) !== true) return;

    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      return send(res, 400, { error: "invalid json", details: e.message });
    }

    const { type, playerId, playerName, data } = body || {};
    if (!type || typeof playerId === "undefined") {
      return send(res, 400, { error: "bad payload", required: ["type", "playerId"] });
    }

    let embeds = [];
    switch (String(type).toLowerCase()) {
      case "status":
      case "server_status":
        embeds = [embedStatus({ online: data?.online, uptimeMin: data?.uptimeMin })];
        break;

      case "join":
      case "player_join": {
        const roles = await getRoleNamesForRoblox(playerId);
        const rolesTxt = roles.names.length ? roles.names.join(", ") : roles.verified ? "(no roles)" : "unverified";
        embeds = [
          embedJoin({
            username: playerName,
            userId: playerId,
            displayName: data?.displayName,
            rolesTxt,
            summitTitle: data?.summitTitle || "-",
            summitCount: data?.summits ?? 0,
          }),
        ];
        break;
      }

      case "left":
      case "player_left": {
        const roles = await getRoleNamesForRoblox(playerId);
        const rolesTxt = roles.names.length ? roles.names.join(", ") : roles.verified ? "(no roles)" : "unverified";
        embeds = [
          embedLeft({
            username: playerName,
            userId: playerId,
            session: data?.session || "Calculating...",
            rolesTxt,
            summitTitle: data?.summitTitle || "-",
            summitCount: data?.summits ?? 0,
          }),
        ];
        break;
      }

      case "summit":
      case "summit_update": {
        embeds = [
          embedGeneric({
            type: "Summit",
            playerName,
            playerId,
            data: { summitTitle: data?.summitTitle, summits: data?.summits },
          }),
        ];
        break;
      }

      default:
        embeds = [embedGeneric({ type, playerName, playerId, data })];
    }

    await sendEmbeds(embeds);
    return send(res, 200, { ok: true, logged: true, as: "embed" });
  }

  // GET /roles-by-roblox?robloxId=... → dipakai Roblox fetch role
  if (req.method === "GET" && path === "/roles-by-roblox") {
    if (okSecret(req, res) !== true) return;

    if (!BLOXLINK_KEY || !GUILD_ID || !DISCORD_BOT_TOKEN) {
      return send(res, 500, {
        error: "misconfig",
        missing: [!BLOXLINK_KEY && "BLOXLINK_KEY", !GUILD_ID && "GUILD_ID", !DISCORD_BOT_TOKEN && "DISCORD_BOT_TOKEN"].filter(Boolean),
      });
    }

    const robloxId = url.searchParams.get("robloxId");
    if (!robloxId) return send(res, 400, { error: "robloxId parameter required" });

    const map = await bloxlinkRobloxToDiscord(robloxId);
    if (!map.discordId) return send(res, 200, { verified: false, discordId: null, roles: [], reason: `no_link_${map.source}`, error: map.error });

    const member = await getGuildMember(map.discordId);
    if (member && member.error) {
      return send(res, 200, {
        verified: false,
        discordId: map.discordId,
        roles: [],
        reason: `discord_api_error_${member.status || "unknown"}`,
        source: map.source,
      });
    }

    const roles = await resolveRoles(member.roles || []);
    return send(res, 200, {
      verified: true,
      discordId: map.discordId,
      roles,
      source: map.source,
      memberInfo: { nick: member.nick, joinedAt: member.joined_at, totalRoles: member.roles?.length || 0 },
    });
  }

  // 404
  return send(res, 404, { error: "endpoint not found", path });
};
