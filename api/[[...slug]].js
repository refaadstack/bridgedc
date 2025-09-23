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
      const errorText = await r.text();
      console.error(`Discord API error: ${r.status} ${r.statusText}`, errorText);
      
      // Return detailed error info
      return {
        error: true,
        status: r.status,
        statusText: r.statusText,
        details: errorText
      };
    }
    
    const memberData = await r.json();
    console.log(`Member data for ${id}:`, JSON.stringify(memberData, null, 2));
    return memberData;
  } catch (error) {
    console.error("Failed to get guild member:", error);
    return { error: true, message: error.message };
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
    console.log(`[BLOXLINK] Looking up Roblox ID: ${robloxId}`);
    
    // 1) Guild-scoped lookup
    const r1 = await fetch(`https://api.blox.link/v4/public/guilds/${GUILD_ID}/roblox-to-discord/${robloxId}`, {
      headers: { Authorization: BLOXLINK_KEY }
    });
    
    console.log(`[BLOXLINK] Guild lookup status: ${r1.status}`);
    
    if (r1.ok) {
      const j = await r1.json();
      console.log(`[BLOXLINK] Guild response:`, JSON.stringify(j, null, 2));
      
      // Check for different response formats
      if (j?.discordId) return { discordId: j.discordId, source: "guild", rawResponse: j };
      if (j?.primaryAccount?.discordId) return { discordId: j.primaryAccount.discordId, source: "guild", rawResponse: j };
      if (j?.data?.primaryAccount?.discordId) return { discordId: j.data.primaryAccount.discordId, source: "guild", rawResponse: j };
      if (Array.isArray(j?.discordIDs) && j.discordIDs.length) return { discordId: j.discordIDs[0], source: "guild", rawResponse: j };
      if (Array.isArray(j?.data?.discordIDs) && j.data.discordIDs.length) return { discordId: j.data.discordIDs[0], source: "guild", rawResponse: j };
    } else {
      const errorText = await r1.text();
      console.log(`[BLOXLINK] Guild lookup error: ${r1.status} - ${errorText}`);
    }

    // 2) Global fallback
    console.log(`[BLOXLINK] Trying global lookup...`);
    const r2 = await fetch(`https://api.blox.link/v4/public/roblox-to-discord/${robloxId}`, {
      headers: { Authorization: BLOXLINK_KEY }
    });
    
    console.log(`[BLOXLINK] Global lookup status: ${r2.status}`);
    
    if (!r2.ok) {
      const errorText = await r2.text();
      console.log(`[BLOXLINK] Global lookup error: ${r2.status} - ${errorText}`);
      return { discordId: null, source: "none", error: `HTTP ${r2.status}`, errorDetails: errorText };
    }
    
    const g = await r2.json();
    console.log(`[BLOXLINK] Global response:`, JSON.stringify(g, null, 2));
    
    // Check for different response formats
    if (g?.discordId) return { discordId: g.discordId, source: "global", rawResponse: g };
    if (g?.primaryAccount?.discordId) return { discordId: g.primaryAccount.discordId, source: "global", rawResponse: g };
    if (g?.data?.primaryAccount?.discordId) return { discordId: g.data.primaryAccount.discordId, source: "global", rawResponse: g };
    if (Array.isArray(g?.discordIDs) && g.discordIDs.length) return { discordId: g.discordIDs[0], source: "global", rawResponse: g };
    if (Array.isArray(g?.data?.discordIDs) && g.data.discordIDs.length) return { discordId: g.data.discordIDs[0], source: "global", rawResponse: g };
    
    return { discordId: null, source: "none", error: "No Discord ID found in response", rawResponse: g };
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
  <li>GET <code>/api/debug/bot-info</code> - Check bot permissions & config</li>
  <li>GET <code>/api/debug/discord-member?discordId=...</code> - Test member fetch</li>
  <li><strong>GET <code>/api/debug/full-test?robloxId=...</code> - Complete diagnostic</strong></li>
</ul>
</div>
<p><strong>Header wajib:</strong> <code>X-Game-Secret</code></p>
<div class="critical">
<h2>🔧 Troubleshooting Steps:</h2>
<ol>
  <li><strong>Run full test:</strong> <code>/api/debug/full-test?robloxId=YOUR_ROBLOX_ID</code></li>
  <li><strong>Check Discord Developer Portal:</strong>
    <ul>
      <li>Bot → Privileged Gateway Intents → ✅ Server Members Intent</li>
      <li>OAuth2 → URL Generator → Scopes: bot → Permissions: Administrator</li>
    </ul>
  </li>
  <li><strong>Verify bot is in guild with proper invite</strong></li>
  <li><strong>Check Bloxlink verification in Discord server</strong></li>
</ol>
</div>
<h2>Common Issues:</h2>
<ul>
  <li><strong>Empty roles[]:</strong> Bot missing Server Members Intent atau tidak punya akses member data</li>
  <li><strong>403 Forbidden:</strong> Bot tidak di guild atau permission insufficient</li>
  <li><strong>404 Not Found:</strong> User tidak ada di guild atau bot tidak bisa see member</li>
  <li><strong>verified: true, roles: []:</strong> User ada tapi bot tidak bisa akses role data</li>
</ul>`,
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

  // GET /debug/full-test?robloxId=... (comprehensive test)
  if (req.method==="GET" && path==="/debug/full-test") {
    if (okSecret(req,res)!==true) return;
    
    const robloxId = url.searchParams.get("robloxId");
    if (!robloxId) return send(res,400,{error:"robloxId parameter required"});
    
    console.log(`[FULL TEST] Starting comprehensive test for Roblox ID: ${robloxId}`);
    
    try {
      // Step 1: Test Bloxlink lookup
      const bloxlinkResult = await bloxlinkRobloxToDiscord(robloxId);
      console.log(`[FULL TEST] Bloxlink result:`, bloxlinkResult);
      
      if (!bloxlinkResult.discordId) {
        return send(res,200,{
          step: "bloxlink_lookup",
          success: false,
          error: "No Discord ID found",
          details: bloxlinkResult
        });
      }
      
      // Step 2: Test bot permissions
      const botTest = await fetch(`https://discord.com/api/v10/users/@me`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
      });
      
      const botData = botTest.ok ? await botTest.json() : null;
      console.log(`[FULL TEST] Bot data:`, botData);
      
      // Step 3: Test guild access
      const guildTest = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
      });
      
      const guildData = guildTest.ok ? await guildTest.json() : { error: guildTest.status };
      console.log(`[FULL TEST] Guild data:`, guildData);
      
      // Step 4: Test member fetch
      const memberResult = await getGuildMember(bloxlinkResult.discordId);
      console.log(`[FULL TEST] Member result:`, memberResult);
      
      // Step 5: Test roles fetch
      const allRoles = await getGuildRoles();
      console.log(`[FULL TEST] Total guild roles:`, allRoles.length);
      
      // Step 6: Try alternative member fetch
      let alternativeMember = null;
      try {
        const altResponse = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${bloxlinkResult.discordId}`, {
          headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
        });
        
        if (altResponse.ok) {
          alternativeMember = await altResponse.json();
        } else {
          const errorBody = await altResponse.text();
          alternativeMember = { 
            error: altResponse.status, 
            statusText: altResponse.statusText,
            body: errorBody 
          };
        }
      } catch (e) {
        alternativeMember = { error: "fetch_failed", message: e.message };
      }
      
      return send(res,200,{
        robloxId,
        steps: {
          "1_bloxlink": {
            success: !!bloxlinkResult.discordId,
            discordId: bloxlinkResult.discordId,
            source: bloxlinkResult.source,
            rawResponse: bloxlinkResult.rawResponse
          },
          "2_bot_auth": {
            success: botTest.ok,
            status: botTest.status,
            botId: botData?.id,
            botUsername: botData?.username
          },
          "3_guild_access": {
            success: guildTest.ok,
            status: guildTest.status,
            guildName: guildData?.name,
            memberCount: guildData?.member_count
          },
          "4_member_fetch": {
            success: memberResult && !memberResult.error,
            hasRoles: memberResult?.roles?.length > 0,
            roleCount: memberResult?.roles?.length || 0,
            memberData: memberResult
          },
          "5_guild_roles": {
            success: Array.isArray(allRoles),
            totalRoles: allRoles.length,
            sampleRoles: allRoles.slice(0, 3).map(r => ({ id: r.id, name: r.name }))
          },
          "6_alternative_member": {
            result: alternativeMember
          }
        }
      });
      
    } catch (error) {
      console.error("[FULL TEST] Error:", error);
      return send(res,500,{ error: error.message });
    }
  }

  // GET /debug/discord-member?discordId=... (untuk troubleshooting)
  if (req.method==="GET" && path==="/debug/discord-member") {
    if (okSecret(req,res)!==true) return;
    
    const discordId = url.searchParams.get("discordId");
    if (!discordId) return send(res,400,{error:"discordId parameter required"});
    
    try {
      // Test direct member fetch
      const memberResult = await getGuildMember(discordId);
      const rolesResult = await getGuildRoles();
      
      return send(res,200,{
        discordId,
        memberResult,
        totalGuildRoles: Array.isArray(rolesResult) ? rolesResult.length : 0,
        sampleRoles: Array.isArray(rolesResult) ? rolesResult.slice(0, 3) : []
      });
    } catch (error) {
      return send(res,500,{ error: error.message });
    }
  }

  // GET /debug/bot-info (untuk troubleshooting)
  if (req.method==="GET" && path==="/debug/bot-info") {
    if (okSecret(req,res)!==true) return;
    
    try {
      // Test bot permissions
      const botUser = await fetch(`https://discord.com/api/v10/users/@me`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
      });
      
      const guildInfo = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
      });
      
      const botMember = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/@me`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
      });
      
      return send(res,200,{
        bot: botUser.ok ? await botUser.json() : { error: botUser.status },
        guild: guildInfo.ok ? await guildInfo.json() : { error: guildInfo.status },
        botMember: botMember.ok ? await botMember.json() : { error: botMember.status },
        config: {
          hasGuildId: !!GUILD_ID,
          hasToken: !!DISCORD_BOT_TOKEN,
          hasBloxlinkKey: !!BLOXLINK_KEY,
          guildId: GUILD_ID
        }
      });
    } catch (error) {
      return send(res,500,{ error: error.message });
    }
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

    console.log(`[DEBUG] Fetching roles for Roblox ID: ${robloxId}`);
    
    const map = await bloxlinkRobloxToDiscord(robloxId);
    console.log(`[DEBUG] Bloxlink result:`, map);
    
    if (!map.discordId) {
      return send(res,200,{
        verified: false,
        discordId: null,
        roles: [],
        reason: `no_link_${map.source}`,
        error: map.error,
        debug: { bloxlinkResult: map }
      });
    }

    console.log(`[DEBUG] Fetching Discord member: ${map.discordId}`);
    const member = await getGuildMember(map.discordId);
    console.log(`[DEBUG] Member result:`, member);
    
    // Handle Discord API errors
    if (member && member.error) {
      return send(res,200,{
        verified: false,
        discordId: map.discordId,
        roles: [],
        reason: `discord_api_error_${member.status || 'unknown'}`,
        source: map.source,
        debug: {
          discordError: {
            status: member.status,
            statusText: member.statusText,
            details: member.details || member.message
          },
          bloxlinkResult: map
        }
      });
    }
    
    if (!member) {
      return send(res,200,{
        verified: false,
        discordId: map.discordId,
        roles: [],
        reason: "not_in_guild_or_no_permission",
        source: map.source,
        debug: { bloxlinkResult: map }
      });
    }

    console.log(`[DEBUG] Member roles:`, member.roles);
    const roles = await resolveRoles(member.roles||[]);
    console.log(`[DEBUG] Resolved roles:`, roles);
    
    return send(res,200,{
      verified: true,
      discordId: map.discordId,
      roles,
      source: map.source,
      memberInfo: {
        nick: member.nick,
        joinedAt: member.joined_at,
        totalRoles: member.roles ? member.roles.length : 0
      },
      debug: {
        rawRoles: member.roles,
        bloxlinkResult: map
      }
    });
  }

  return send(res,404,{error:"endpoint not found", path});
};