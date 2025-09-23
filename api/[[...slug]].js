// api/[[...slug]].js — single file, no Express, embeds-ready
const {
  GUILD_ID, DISCORD_BOT_TOKEN, DISCORD_LOG_WEBHOOK_URL,
  BLOXLINK_KEY, SHARED_SECRET,
} = process.env;

const NOW = () => Math.floor(Date.now()/1000);
const send = (res, code, body, type="application/json") => {
  res.statusCode = code;
  res.setHeader("Content-Type", type);
  res.end(type==="application/json" ? JSON.stringify(body) : body);
};
const okSecret = (req,res)=> {
  if (!SHARED_SECRET) return send(res,500,{error:"SHARED_SECRET missing"});
  if (req.headers["x-game-secret"] !== SHARED_SECRET) return send(res,401,{error:"unauthorized"});
  return true;
};
const parseBody = async (req)=>{
  const b=[]; for await (const c of req) b.push(c);
  return b.length? JSON.parse(Buffer.concat(b).toString("utf8")) : {};
};

/* ===== Discord webhook: embeds ===== */
const sendEmbeds = async (embeds = []) => {
  if (!DISCORD_LOG_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_LOG_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds }),
    });
  } catch (e) { console.error("Webhook error:", e); }
};
// fallback content (optional)
const postToDiscord = async (content)=>{
  if (!DISCORD_LOG_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_LOG_WEBHOOK_URL,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ content })
    });
  } catch (e) { console.error("Failed to post to Discord:", e); }
};

const COLORS = { blue:0x2b88ff, green:0x22cc66, red:0xff3333, gray:0x2f3136 };
const base = (title, color) => ({ title, color, timestamp: new Date().toISOString() });

const embedStatus = ({ online = 0, uptimeMin = "n/a" }={}) => ({
  ...base("Server Status Update", COLORS.blue),
  fields: [
    { name: "Players Online", value: String(online), inline: true },
    { name: "Server Uptime", value: `${uptimeMin} minutes`, inline: true },
  ],
});
const embedJoin = ({ username = "-", userId = "-", displayName = "-" }={}) => ({
  ...base("Player Joined", COLORS.green),
  description: `${username} joined the server`,
  fields: [
    { name: "User ID", value: String(userId), inline: true },
    { name: "Display Name", value: String(displayName || "-"), inline: true },
  ],
});
const embedLeft = ({ username = "-", userId = "-", session = "Calculating..." }={}) => ({
  ...base("Player Left", COLORS.red),
  description: `${username} left the server`,
  fields: [
    { name: "User ID", value: String(userId), inline: true },
    { name: "Session Time", value: String(session), inline: true },
  ],
});
const embedGeneric = ({ type, playerName, playerId, data }={}) => ({
  ...base(`[${String(type||"LOG").toUpperCase()}]`, COLORS.gray),
  description: `Player: ${playerName ?? "unknown"} (${playerId ?? "-"})`,
  fields: data ? [{ name:"Data", value:"```json\n"+JSON.stringify(data,null,2)+"\n```" }] : undefined,
});

/* ===== Discord REST helpers ===== */
const getGuildMember = async(id)=>{
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${id}`,{
      headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}
    });
    if (!r.ok) {
      const errorText = await r.text();
      return { error:true, status:r.status, statusText:r.statusText, details:errorText };
    }
    return await r.json();
  } catch (e) { return { error:true, message:e.message }; }
};
const getGuildRoles = async()=>{
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`,{
      headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}
    });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
};
const resolveRoles = async(ids=[])=>{
  const all = await getGuildRoles();
  if (!Array.isArray(all)) return [];
  const byId = Object.fromEntries(all.map(x=>[x.id,x]));
  return ids.map(id=>({ id, name: byId[id]?.name || `Unknown Role (${id})` }));
};

/* ===== Bloxlink map Roblox->Discord ===== */
async function bloxlinkRobloxToDiscord(robloxId){
  try {
    // guild-scoped
    const r1 = await fetch(`https://api.blox.link/v4/public/guilds/${GUILD_ID}/roblox-to-discord/${robloxId}`, {
      headers: { Authorization: BLOXLINK_KEY }
    });
    if (r1.ok) {
      const j = await r1.json();
      if (j?.discordId) return { discordId:j.discordId, source:"guild", rawResponse:j };
      if (j?.primaryAccount?.discordId) return { discordId:j.primaryAccount.discordId, source:"guild", rawResponse:j };
      if (j?.data?.primaryAccount?.discordId) return { discordId:j.data.primaryAccount.discordId, source:"guild", rawResponse:j };
      if (Array.isArray(j?.discordIDs)&&j.discordIDs.length) return { discordId:j.discordIDs[0], source:"guild", rawResponse:j };
      if (Array.isArray(j?.data?.discordIDs)&&j.data.discordIDs.length) return { discordId:j.data.discordIDs[0], source:"guild", rawResponse:j };
    }
    // global
    const r2 = await fetch(`https://api.blox.link/v4/public/roblox-to-discord/${robloxId}`, {
      headers: { Authorization: BLOXLINK_KEY }
    });
    if (!r2.ok) {
      const t = await r2.text();
      return { discordId:null, source:"none", error:`HTTP ${r2.status}`, errorDetails:t };
    }
    const g = await r2.json();
    if (g?.discordId) return { discordId:g.discordId, source:"global", rawResponse:g };
    if (g?.primaryAccount?.discordId) return { discordId:g.primaryAccount.discordId, source:"global", rawResponse:g };
    if (g?.data?.primaryAccount?.discordId) return { discordId:g.data.primaryAccount.discordId, source:"global", rawResponse:g };
    if (Array.isArray(g?.discordIDs)&&g.discordIDs.length) return { discordId:g.discordIDs[0], source:"global", rawResponse:g };
    if (Array.isArray(g?.data?.discordIDs)&&g.data.discordIDs.length) return { discordId:g.data.discordIDs[0], source:"global", rawResponse:g };
    return { discordId:null, source:"none", error:"No Discord ID found in response", rawResponse:g };
  } catch (e) { return { discordId:null, source:"error", error:e.message }; }
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/^\/api/, "") || "/";

  // HTML status
  if (req.method==="GET" && (path==="/" || path==="/health") && url.searchParams.get("format")==="html") {
    return send(res,200,
`<!doctype html><meta charset="utf-8"><title>Bridge OK</title>
<style>body{font:14px system-ui;margin:40px}code{background:#f4f4f4;padding:2px 4px;border-radius:4px}.debug{background:#fff3cd;padding:10px;margin:10px 0;border-radius:4px}.critical{background:#f8d7da;padding:10px;margin:10px 0;border-radius:4px}</style>
<h1>✅ Roblox↔Discord Bridge aktif</h1>
<h2>API Endpoints:</h2>
<ul>
  <li>GET <code>/api/health</code></li>
  <li>POST <code>/api/log</code></li>
  <li>GET <code>/api/roles-by-roblox?robloxId=...</code></li>
</ul>
<h2>Debug Endpoints:</h2>
<div class="debug">
<ul>
  <li>GET <code>/api/debug/bot-info</code></li>
  <li>GET <code>/api/debug/discord-member?discordId=...</code></li>
  <li><strong>GET <code>/api/debug/full-test?robloxId=...</code></strong></li>
</ul>
</div>
<p><strong>Header wajib:</strong> <code>X-Game-Secret</code></p>
<div class="critical">
<h2>🔧 Troubleshooting:</h2>
<ol>
  <li>Hit <code>/api/debug/full-test?robloxId=YOUR_ROBLOX_ID</code></li>
  <li>Bot intents: ✅ Server Members Intent</li>
  <li>Bot ada di guild + permissions cukup</li>
  <li>User terverifikasi di Bloxlink</li>
</ol>
</div>`,
      "text/html"
    );
  }

  // JSON health
  if (req.method==="GET" && (path==="/" || path==="/health")) {
    return send(res,200,{ok:true, timestamp: NOW()});
  }

  // POST /log -> kirim EMBED rapi
  if (req.method==="POST" && path==="/log") {
    if (okSecret(req,res)!==true) return;

    let body;
    try { body = await parseBody(req); }
    catch (error) { return send(res,400,{ error:"invalid json", details:error.message }); }

    const { type, playerId, playerName, data } = body || {};
    if (!type || typeof playerId==="undefined") {
      return send(res,400,{ error:"bad payload", required:["type","playerId"] });
    }

    let embeds = [];
    switch (String(type).toLowerCase()) {
      case "server_status":
      case "status":
        embeds = [embedStatus({ online: data?.online, uptimeMin: data?.uptimeMin })];
        break;
      case "join":
      case "player_join":
        embeds = [embedJoin({ username: playerName, userId: playerId, displayName: data?.displayName })];
        break;
      case "left":
      case "player_left":
        embeds = [embedLeft({ username: playerName, userId: playerId, session: data?.session || "Calculating..." })];
        break;
      default:
        embeds = [embedGeneric({ type, playerName, playerId, data })];
    }

    await sendEmbeds(embeds);
    return send(res,200,{ ok:true, logged:true, as:"embed" });
  }

  // GET /debug/full-test?robloxId=...
  if (req.method==="GET" && path==="/debug/full-test") {
    if (okSecret(req,res)!==true) return;

    const robloxId = url.searchParams.get("robloxId");
    if (!robloxId) return send(res,400,{error:"robloxId parameter required"});

    try {
      const bloxlinkResult = await bloxlinkRobloxToDiscord(robloxId);
      if (!bloxlinkResult.discordId) {
        return send(res,200,{ step:"bloxlink_lookup", success:false, error:"No Discord ID found", details:bloxlinkResult });
      }

      const botTest = await fetch(`https://discord.com/api/v10/users/@me`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
      });
      const botData = botTest.ok ? await botTest.json() : null;

      const guildTest = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
      });
      const guildData = guildTest.ok ? await guildTest.json() : { error: guildTest.status };

      const memberResult = await getGuildMember(bloxlinkResult.discordId);
      const allRoles = await getGuildRoles();

      return send(res,200,{
        robloxId,
        steps: {
          "1_bloxlink": { success: !!bloxlinkResult.discordId, discordId: bloxlinkResult.discordId, source: bloxlinkResult.source, rawResponse: bloxlinkResult.rawResponse },
          "2_bot_auth": { success: botTest.ok, status: botTest.status, botId: botData?.id, botUsername: botData?.username },
          "3_guild_access": { success: guildTest.ok, status: guildTest.status, guildName: guildData?.name, memberCount: guildData?.member_count },
          "4_member_fetch": { success: memberResult && !memberResult.error, hasRoles: memberResult?.roles?.length>0, roleCount: memberResult?.roles?.length||0, memberData: memberResult },
          "5_guild_roles": { success: Array.isArray(allRoles), totalRoles: allRoles.length, sampleRoles: allRoles.slice(0,3).map(r=>({id:r.id,name:r.name})) },
        }
      });
    } catch (e) { return send(res,500,{ error:e.message }); }
  }

  // GET /debug/discord-member?discordId=...
  if (req.method==="GET" && path==="/debug/discord-member") {
    if (okSecret(req,res)!==true) return;
    const discordId = url.searchParams.get("discordId");
    if (!discordId) return send(res,400,{error:"discordId parameter required"});
    try {
      const memberResult = await getGuildMember(discordId);
      const rolesResult = await getGuildRoles();
      return send(res,200,{
        discordId,
        memberResult,
        totalGuildRoles: Array.isArray(rolesResult) ? rolesResult.length : 0,
        sampleRoles: Array.isArray(rolesResult) ? rolesResult.slice(0,3) : []
      });
    } catch (e) { return send(res,500,{ error:e.message }); }
  }

  // GET /debug/bot-info
  if (req.method==="GET" && path==="/debug/bot-info") {
    if (okSecret(req,res)!==true) return;
    try {
      const botUser = await fetch(`https://discord.com/api/v10/users/@me`, { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } });
      const guildInfo = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}`, { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } });
      const botMember = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/@me`, { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } });
      return send(res,200,{
        bot: botUser.ok ? await botUser.json() : { error: botUser.status },
        guild: guildInfo.ok ? await guildInfo.json() : { error: guildInfo.status },
        botMember: botMember.ok ? await botMember.json() : { error: botMember.status },
        config: { hasGuildId: !!GUILD_ID, hasToken: !!DISCORD_BOT_TOKEN, hasBloxlinkKey: !!BLOXLINK_KEY, guildId: GUILD_ID }
      });
    } catch (e) { return send(res,500,{ error:e.message }); }
  }

  // GET /roles-by-roblox?robloxId=...
  if (req.method==="GET" && path==="/roles-by-roblox") {
    if (okSecret(req,res)!==true) return;

    if (!BLOXLINK_KEY || !GUILD_ID || !DISCORD_BOT_TOKEN) {
      return send(res,500,{
        error:"misconfig",
        missing:[
          !BLOXLINK_KEY && "BLOXLINK_KEY",
          !GUILD_ID && "GUILD_ID",
          !DISCORD_BOT_TOKEN && "DISCORD_BOT_TOKEN"
        ].filter(Boolean)
      });
    }

    const robloxId = url.searchParams.get("robloxId");
    if (!robloxId) return send(res,400,{error:"robloxId parameter required"});

    const map = await bloxlinkRobloxToDiscord(robloxId);
    if (!map.discordId) {
      return send(res,200,{
        verified:false, discordId:null, roles:[],
        reason:`no_link_${map.source}`, error:map.error, debug:{ bloxlinkResult:map }
      });
    }

    const member = await getGuildMember(map.discordId);
    if (member && member.error) {
      return send(res,200,{
        verified:false, discordId:map.discordId, roles:[],
        reason:`discord_api_error_${member.status||'unknown'}`, source:map.source,
        debug:{ discordError:{ status:member.status, statusText:member.statusText, details:member.details||member.message }, bloxlinkResult:map }
      });
    }
    if (!member) {
      return send(res,200,{
        verified:false, discordId:map.discordId, roles:[],
        reason:"not_in_guild_or_no_permission", source:map.source, debug:{ bloxlinkResult:map }
      });
    }

    const roles = await resolveRoles(member.roles||[]);
    return send(res,200,{
      verified:true,
      discordId:map.discordId,
      roles,
      source:map.source,
      memberInfo:{ nick:member.nick, joinedAt:member.joined_at, totalRoles:member.roles?member.roles.length:0 },
      debug:{ rawRoles:member.roles, bloxlinkResult:map }
    });
  }

  return send(res,404,{error:"endpoint not found", path});
};
