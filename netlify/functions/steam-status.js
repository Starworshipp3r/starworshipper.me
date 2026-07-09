const NAME_ALIASES = {
  "Source SDK Base 2007": "FiveM",
};

const STEAM_PROFILE_URL = process.env.STEAM_PROFILE_URL || "https://steamcommunity.com/id/Starworshipp3r";

function getDisplayName(name) {
  if (!name) return null;
  return NAME_ALIASES[name] || name;
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function getProfileRecentGame() {
  try {
    const profileRes = await fetch(STEAM_PROFILE_URL, {
      headers: {
        "user-agent": "Mozilla/5.0 StarworshipperSite/1.0",
      },
    });

    if (!profileRes.ok) return null;

    const html = await profileRes.text();
    const match = html.match(
      /<div class="recent_game">[\s\S]*?<div class="game_name"><a class="whiteLink" href="https:\/\/steamcommunity\.com\/app\/(?<appid>\d+)">(?<name>[\s\S]*?)<\/a><\/div>/
    );

    if (!match?.groups?.name) return null;

    return {
      appid: match.groups.appid,
      name: decodeHtml(match.groups.name.replace(/<[^>]*>/g, "").trim()),
    };
  } catch {
    return null;
  }
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

    const profileRecent = await getProfileRecentGame();
    if (profileRecent?.name) {
      return {
        statusCode: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=60",
        },
        body: JSON.stringify({
          playing: getDisplayName(profileRecent.name),
          mode: "profile",
          appid: profileRecent.appid,
          lastPlayed: null,
        }),
      };
    }

    // 3) Otherwise: use owned-game timestamps for actual last-played order
    const gRes = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1`
    );
    if (gRes.ok) {
      const gJson = await gRes.json();
      const games = gJson?.response?.games || [];

      let latest = null;
      for (const g of games) {
        if (!g.rtime_last_played) continue;
        if (!latest || g.rtime_last_played > latest.rtime_last_played) latest = g;
      }

      if (latest?.name) {
        return {
          statusCode: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=60",
          },
          body: JSON.stringify({
            playing: getDisplayName(latest.name),
            mode: "last",
            lastPlayed: latest.rtime_last_played || null,
          }),
        };
      }
    }

    // 4) Last resort: Steam's recent feed can be stale or unordered
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
            "cache-control": "public, max-age=60",
          },
          body: JSON.stringify({
            playing: getDisplayName(latestRecent.name),
            mode: "recent",
            lastPlayed: latestRecent.rtime_last_played || null,
          }),
        };
      }
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60",
      },
      body: JSON.stringify({
        playing: null,
        mode: "unknown",
        lastPlayed: null,
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
