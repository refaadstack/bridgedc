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
  await fetch(DISCORD_LOG_WEBHOOK_URL,{
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ content })
  }).catch(()=>{});
};
const getGuildMember = async(id)=>{
  const r=await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${id}`,{
    headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}
  });
  return r.ok? r.json(): null;
};
const getGuildRoles = async()=>{
  const r=await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`,{
    headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}` }
  });
  return r.ok? r.json(): [];
};
const resolveRoles = async(ids=[])=>{
  const all=await getGuildRoles();
  const byId=Object.fromEntries(all.map(x=>[x.id,x]));
  return ids.map(id=>({id,name:byId[id]?.name||id}));
};

// Bloxlink: guild-scoped → global, handle {primaryAccount.discordId} dan {discordIDs:[...]}
async function bloxlinkRobloxToDiscord(robloxId){
  // 1) Guild-scoped
  const r1 = await fetch(`https://api.blox.link/v4/public/guilds/${GUILD_ID}/roblox-to-discord/${robloxId}`, {
    headers: { Authorization: BLOXLINK_KEY }
  });
  if (r1.ok) {
    const j = await r1.json();
    if (j?.primaryAccount?.discordId) return { discordId: j.primaryAccount.discordId, source: "guild" };
    if (Array.isArray(j.discordIDs) && j.discordIDs.length) return { discordId: j.discordIDs[0], source: "guild" };
  }

  // 2) Global fallback
  const r2 = await fetch(`https://api.blox.link/v4/public/roblox-to-discord/${robloxId}`, {
    headers: { Authorization: BLOXLINK_KEY }
  });
  if (!r2.ok) return { discordId: null, source: "none" };
  const g = await r2.json();
  if (g?.primaryAccount?.discordId) return { discordId: g.primaryAccount.discordId, source: "global" };
  if (Array.isArray(g.discordIDs) && g.discordIDs.length) return { discordId: g.discordIDs[0], source: "global" };
  return { discordId: null, source: "none" };
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
    return send(res,200,{ok:true});
  }

  // POST /log
  if (req.method==="POST" && path==="/log") {
    if (okSecret(req,res)!==true) return;
    let body; try{ body=await parseBody(req);}catch{ return send(res,400,{error:"invalid json"}); }
    const { type, playerId, playerName, data } = body||{};
    if (!type || typeof playerId==="undefined") return send(res,400,{error:"bad payload"});
    const msg = [
      `**[${String(type).toUpperCase()}]**`,
      `Player: ${playerName??"unknown"} (${playerId})`,
      data?("```json\n"+JSON.stringify(data,null,2)+"\n```"):null,
      `At: <t:${NOW()}:F>`
    ].filter(Boolean).join("\n");
    await postToDiscord(msg);
    return send(res,200,{ok:true});
  }

  // GET /roles-by-roblox?robloxId=...
  if (req.method==="GET" && path==="/roles-by-roblox") {
    if (okSecret(req,res)!==true) return;
    if (!BLOXLINK_KEY || !GUILD_ID || !DISCORD_BOT_TOKEN)
      return send(res,500,{error:"misconfig: BLOXLINK_KEY/GUILD_ID/DISCORD_BOT_TOKEN"});

    const robloxId = url.searchParams.get("robloxId");
    if (!robloxId) return send(res,400,{error:"robloxId required"});

    const map = await bloxlinkRobloxToDiscord(robloxId);
    if (!map.discordId)
      return send(res,200,{verified:false,discordId:null,roles:[],reason:`no_link_${map.source}`});

    const member = await getGuildMember(map.discordId);
    if (!member)
      return send(res,200,{verified:true,discordId:map.discordId,roles:[],reason:"not_in_guild_or_no_permission",source:map.source});

    const roles = await resolveRoles(member.roles||[]);
    return send(res,200,{verified:true,discordId:map.discordId,roles,source:map.source});
  }

  return send(res,404,{error:"not found"});
};
