// single file, no Express
const {
    GUILD_ID, DISCORD_BOT_TOKEN, DISCORD_LOG_WEBHOOK_URL,
    BLOXLINK_KEY, SHARED_SECRET,
  } = process.env;
  
  const NOW = () => Math.floor(Date.now()/1000);
  const send = (res, code, obj) => { res.statusCode=code; res.setHeader("Content-Type","application/json"); res.end(JSON.stringify(obj)); };
  const okSecret = (req,res)=> SHARED_SECRET ? (req.headers["x-game-secret"]===SHARED_SECRET || !send(res,401,{error:"unauthorized"})) : !send(res,500,{error:"SHARED_SECRET missing"});
  const parseBody = async (req)=>{ const b=[]; for await (const c of req) b.push(c); return b.length?JSON.parse(Buffer.concat(b).toString("utf8")):{}; };
  
  const postToDiscord = async (content)=>{
    if (!DISCORD_LOG_WEBHOOK_URL) return;
    await fetch(DISCORD_LOG_WEBHOOK_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content})}).catch(()=>{});
  };
  const getGuildMember = async(id)=>{ const r=await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${id}`,{headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}}); return r.ok? r.json(): null; };
  const getGuildRoles = async()=>{ const r=await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`,{headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}}); return r.ok? r.json(): []; };
  const resolveRoles = async(ids=[])=>{ const all=await getGuildRoles(); const byId=Object.fromEntries(all.map(x=>[x.id,x])); return ids.map(id=>({id,name:byId[id]?.name||id})); };
  const bloxlinkRobloxToDiscord = async(robloxId)=>{ const r=await fetch(`https://api.blox.link/v4/public/roblox-to-discord/${robloxId}`,{headers:{Authorization:BLOXLINK_KEY}}); if(!r.ok) return null; const j=await r.json(); return j?.primaryAccount?.discordId||null; };
  
  module.exports = async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname; // /api, /api/log, /api/roles-by-roblox
  
    if (req.method==="GET" && (p==="/api" || p==="/api/" || p==="/api/health")) return send(res,200,{ok:true});
  
    if (req.method==="POST" && p==="/api/log") {
      if (okSecret(req,res)!==true) return;
      let body; try{ body=await parseBody(req);}catch{ return send(res,400,{error:"invalid json"}); }
      const { type, playerId, playerName, data } = body||{};
      if (!type || typeof playerId==="undefined") return send(res,400,{error:"bad payload"});
      const msg = [`**[${String(type).toUpperCase()}]**`,`Player: ${playerName??"unknown"} (${playerId})`,data?("```json\n"+JSON.stringify(data,null,2)+"\n```"):null,`At: <t:${NOW()}:F>`].filter(Boolean).join("\n");
      await postToDiscord(msg);
      return send(res,200,{ok:true});
    }
  
    if (req.method==="GET" && p==="/api/roles-by-roblox") {
      if (okSecret(req,res)!==true) return;
      const robloxId = url.searchParams.get("robloxId");
      if (!robloxId) return send(res,400,{error:"robloxId required"});
      if (!BLOXLINK_KEY || !GUILD_ID || !DISCORD_BOT_TOKEN) return send(res,500,{error:"misconfig: BLOXLINK_KEY/GUILD_ID/DISCORD_BOT_TOKEN"});
      const discordId = await bloxlinkRobloxToDiscord(robloxId);
      if (!discordId) return send(res,200,{verified:false,discordId:null,roles:[]});
      const member = await getGuildMember(discordId);
      if (!member) return send(res,200,{verified:true,discordId,roles:[]});
      const roles = await resolveRoles(member.roles||[]);
      return send(res,200,{verified:true,discordId,roles});
    }
  
    return send(res,404,{error:"not found"});
  };
  