// api/[[...slug]].js — single file, no Express
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

const postToDiscord = async (content)=>{
  if (!DISCORD_LOG_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_LOG_WEBHOOK_URL,{
      method:"POST", 
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ content })
    });
  } catch (error) {
    console.error("Failed to post to Discord:", error);
  }
};

const getGuildMember = async(id)=>{
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${id}`,{
      headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}
    });
    if (!r.ok) {
      console.error(`Discord API error: ${r.status} ${r.statusText}`);
      return null;
    }
    return await r.json();
  } catch (error) {
    console.error("Failed to get guild member:", error);
    return null;
  }
};

const getGuildRoles = async()=>{
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`,{
      headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}
    });
    if (!r.ok) {
      console.error(`Discord API error: ${r.status} ${r.statusText}`);
      return [];
    }
    return await r.json();
  } catch (error) {
    console.error("Failed to get guild roles:", error);
    return [];
  }
};

const resolveRoles = async(ids=[])=>{
  const all = await getGuildRoles();
  if (!Array.isArray(all)) return [];
  
  const byId = Object.fromEntries(all.map(x=>[x.id,x]));
  return ids.map(id=>({
    id,
    name: byId[id]?.name || `Unknown Role (${id})`
  }));
};

// Bloxlink: guild-scoped → global, handle different response formats
async function bloxlinkRobloxToDiscord(robloxId){
  try {
    // 1) Guild-scoped lookup
    const r1 = await fetch(`https://api.blox.link/v4/public/guilds/${GUILD_ID}/roblox-to-discord/${robloxId}`, {
      headers: { Authorization: BLOXLINK_KEY }
    });
    
    if (r1.ok) {
      const j = await r1.json();
      
      // Check for different response formats
      if (j?.discordId) return { discordId: j.discordId, source: "guild" };
      if (j?.primaryAccount?.discordId) return { discordId: j.primaryAccount.discordId, source: "guild" };
      if (j?.data?.primaryAccount?.discordId) return { discordId: j.data.primaryAccount.discordId, source: "guild" };
      if (Array.isArray(j?.discordIDs) && j.discordIDs.length) return { discordId: j.discordIDs[0], source: "guild" };
      if (Array.isArray(j?.data?.discordIDs) && j.data.discordIDs.length) return { discordId: j.data.discordIDs[0], source: "guild" };
    }

    // 2) Global fallback
    const r2 = await fetch(`https://api.blox.link/v4/public/roblox-to-discord/${robloxId}`, {
      headers: { Authorization: BLOXLINK_KEY }
    });
    
    if (!r2.ok) return { discordId: null, source: "none", error: `HTTP ${r2.status}` };
    
    const g = await r2.json();
    
    // Check for different response formats
    if (g?.discordId) return { discordId: g.discordId, source: "global" };
    if (g?.primaryAccount?.discordId) return { discordId: g.primaryAccount.discordId, source: "global" };
    if (g?.data?.primaryAccount?.discordId) return { discordId: g.data.primaryAccount.discordId, source: "global" };
    if (Array.isArray(g?.discordIDs) && g.discordIDs.length) return { discordId: g.discordIDs[0], source: "global" };
    if (Array.isArray(g?.data?.discordIDs) && g.data.discordIDs.length) return { discordId: g.data.discordIDs[0], source: "global" };
    
    return { discordId: null, source: "none", error: "No Discord ID found in response" };
  } catch (error) {
    console.error("Bloxlink API error:", error);
    return { discordId: null, source: "error", error: error.message };
  }
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/^\/api/, "") || "/";

  // HTML status
  if (req.method==="GET" && (path==="/" || path==="/health") && url.searchParams.get("format")==="html") {
    return send(res,200,
`<!doctype html><meta charset="utf-8"><title>Bridge OK</title>
<style>body{font:14px system-ui;margin:40px}code{background:#f4f4f4;padding:2px 4px;border-radius:4px}</style>
<h1>✅ Roblox↔Discord Bridge aktif</h1>
<ul>
  <li>GET <code>/api/health</code></li>
  <li>POST <code>/api/log</code></li>
  <li>GET <code>/api/roles-by-roblox?robloxId=...</code></li>
</ul>
<p>Header wajib: <code>X-Game-Secret</code></p>`,
      "text/html"
    );
  }

  // JSON health
  if (req.method==="GET" && (path==="/" || path==="/health")) {
    return send(res,200,{ok:true, timestamp: NOW()});
  }

  // POST /log
  if (req.method==="POST" && path==="/log") {
    if (okSecret(req,res)!==true) return;
    
    let body; 
    try { 
      body = await parseBody(req);
    } catch(error) { 
      return send(res,400,{error:"invalid json", details: error.message}); 
    }
    
    const { type, playerId, playerName, data } = body||{};
    if (!type || typeof playerId==="undefined") {
      return send(res,400,{error:"bad payload", required: ["type", "playerId"]});
    }
    
    const msg = [
      `**[${String(type).toUpperCase()}]**`,
      `Player: ${playerName??"unknown"} (${playerId})`,
      data ? ("```json\n"+JSON.stringify(data,null,2)+"\n```") : null,
      `At: <t:${NOW()}:F>`
    ].filter(Boolean).join("\n");
    
    await postToDiscord(msg);
    return send(res,200,{ok:true, logged: true});
  }

  // GET /roles-by-roblox?robloxId=...
  if (req.method==="GET" && path==="/roles-by-roblox") {
    if (okSecret(req,res)!==true) return;
    
    if (!BLOXLINK_KEY || !GUILD_ID || !DISCORD_BOT_TOKEN) {
      return send(res,500,{
        error:"misconfig", 
        missing: [
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
        verified: false,
        discordId: null,
        roles: [],
        reason: `no_link_${map.source}`,
        error: map.error
      });
    }

    const member = await getGuildMember(map.discordId);
    if (!member) {
      return send(res,200,{
        verified: true,
        discordId: map.discordId,
        roles: [],
        reason: "not_in_guild_or_no_permission",
        source: map.source
      });
    }

    const roles = await resolveRoles(member.roles||[]);
    return send(res,200,{
      verified: true,
      discordId: map.discordId,
      roles,
      source: map.source,
      memberInfo: {
        nick: member.nick,
        joinedAt: member.joined_at
      }
    });
  }

  return send(res,404,{error:"endpoint not found", path});
};