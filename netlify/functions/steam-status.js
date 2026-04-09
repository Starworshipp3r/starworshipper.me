const NAME_ALIASES = {
  "Source SDK Base 2007": "FiveM",
};

function getDisplayName(name) {
  if (!name) return null;
  return NAME_ALIASES[name] || name;
}

export async function handler() {
  const key = process.env.STEAM_API_KEY;
  const steamid = process.env.STEAM_ID64;

  if (!key || !steamid) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Missing STEAM_API_KEY or STEAM_ID64" }),
    };
  }

  try {
    // 1) If currently in-game, Steam returns gameextrainfo
    const sRes = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamid}`
    );
    const sJson = await sRes.json();
    const player = sJson?.response?.players?.[0];

    if (player?.gameextrainfo) {
      return {
        statusCode: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=60",
        },
        body: JSON.stringify({ playing: getDisplayName(player.gameextrainfo), mode: "now" }),
      };
    }

    // 2) Otherwise: prefer Steam's recent activity feed
    const recentRes = await fetch(
      `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${key}&steamid=${steamid}`
    );

    if (recentRes.ok) {
      const recentJson = await recentRes.json();
      const recentGames = recentJson?.response?.games || [];
      const latestRecent = recentGames[0];

      if (latestRecent?.name) {
        return {
          statusCode: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=300",
          },
          body: JSON.stringify({
            playing: getDisplayName(latestRecent.name),
            mode: "recent",
            lastPlayed: latestRecent.rtime_last_played || null,
          }),
        };
      }
    }

    // 3) Last resort: find most recently played from owned games
    const gRes = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1`
    );
    const gJson = await gRes.json();
    const games = gJson?.response?.games || [];

    let latest = null;
    for (const g of games) {
      if (!g.rtime_last_played) continue;
      if (!latest || g.rtime_last_played > latest.rtime_last_played) latest = g;
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300",
      },
      body: JSON.stringify({
        playing: getDisplayName(latest?.name),
        mode: "last",
        lastPlayed: latest?.rtime_last_played || null,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Steam fetch failed" }),
    };
  }
}
