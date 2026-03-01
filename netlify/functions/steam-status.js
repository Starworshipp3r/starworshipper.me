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
          // short cache for "now playing"
          "cache-control": "public, max-age=20",
        },
        body: JSON.stringify({ playing: player.gameextrainfo, mode: "now" }),
      };
    }

    // 2) Otherwise: use "recently played" list first.
    // This often matches what Steam shows in the client/profile (including some non-owned/free apps),
    // while GetOwnedGames can miss entries or attribute time to the base game.
    const rRes = await fetch(
      `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${key}&steamid=${steamid}&count=1`
    );
    const rJson = await rRes.json();
    const recent = rJson?.response?.games?.[0];

    if (recent?.name) {
      return {
        statusCode: 200,
        headers: {
          "content-type": "application/json",
          // moderate cache is fine here
          "cache-control": "public, max-age=60",
        },
        body: JSON.stringify({
          playing: recent.name,
          mode: "recent",
          appid: recent.appid ?? null,
          playtime2Weeks: recent.playtime_2weeks ?? null,
        }),
      };
    }

    // 3) Fallback: find most recently played from owned games (has rtime_last_played)
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
        "cache-control": "public, max-age=180",
      },
      body: JSON.stringify({
        playing: latest?.name || null,
        mode: "owned_fallback",
        lastPlayed: latest?.rtime_last_played || null,
        appid: latest?.appid ?? null,
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
