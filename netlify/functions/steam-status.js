const NAME_ALIASES = {
  "Source SDK Base 2007": "FiveM",
};

const STEAM_PROFILE_URL = process.env.STEAM_PROFILE_URL || "https://steamcommunity.com/id/Starworshipp3r";

function isDebugRequest(event) {
  const value = event?.queryStringParameters?.debug;
  return ["1", "true", "yes"].includes(String(value || "").toLowerCase());
}

function getHeaders(debug) {
  return {
    "content-type": "application/json",
    "cache-control": debug ? "no-store" : "public, max-age=60",
  };
}

function toIso(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function send(statusCode, payload, debug, debugInfo) {
  return {
    statusCode,
    headers: getHeaders(debug),
    body: JSON.stringify(debug ? { ...payload, debug: debugInfo } : payload),
  };
}

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

async function getProfileRecentGame(debugInfo) {
  const profileDebug = {
    attempted: true,
    url: STEAM_PROFILE_URL,
  };
  debugInfo.sources.profile = profileDebug;

  try {
    const profileRes = await fetch(STEAM_PROFILE_URL, {
      headers: {
        "user-agent": "Mozilla/5.0 StarworshipperSite/1.0",
      },
    });

    profileDebug.ok = profileRes.ok;
    profileDebug.status = profileRes.status || null;
    profileDebug.contentType = profileRes.headers?.get?.("content-type") || null;

    if (!profileRes.ok) {
      profileDebug.reason = "profile fetch was not ok";
      return null;
    }

    const html = await profileRes.text();
    const recentGamePattern =
      /<div class="recent_game">[\s\S]*?<div class="game_name"><a class="whiteLink" href="https:\/\/steamcommunity\.com\/app\/(?<appid>\d+)">(?<name>[\s\S]*?)<\/a><\/div>/g;
    const matches = [...html.matchAll(recentGamePattern)];
    const recentGames = matches.slice(0, 5).map((match) => ({
      appid: match.groups.appid,
      name: decodeHtml(match.groups.name.replace(/<[^>]*>/g, "").trim()),
    }));

    profileDebug.htmlLength = html.length;
    profileDebug.hasRecentGameMarkup = html.includes("recent_game");
    profileDebug.recentGames = recentGames;

    const match = matches[0];

    if (!match?.groups?.name) {
      profileDebug.reason = "no recent game match in profile html";
      return null;
    }

    const name = decodeHtml(match.groups.name.replace(/<[^>]*>/g, "").trim());
    profileDebug.selected = {
      appid: match.groups.appid,
      name,
      displayName: getDisplayName(name),
    };

    return {
      appid: match.groups.appid,
      name,
    };
  } catch (error) {
    profileDebug.reason = "profile fetch threw";
    profileDebug.error = error?.name || "Error";
    return null;
  }
}

function getLatestOwnedGame(games, debugInfo) {
  let latest = null;
  for (const g of games) {
    if (!g.rtime_last_played) continue;
    if (!latest || g.rtime_last_played > latest.rtime_last_played) latest = g;
  }

  debugInfo.sources.ownedGames.latest = latest
    ? {
        appid: latest.appid || null,
        name: latest.name,
        displayName: getDisplayName(latest.name),
        lastPlayed: latest.rtime_last_played || null,
        lastPlayedIso: toIso(latest.rtime_last_played),
      }
    : null;

  debugInfo.sources.ownedGames.topGames = games
    .filter((game) => game.rtime_last_played)
    .sort((a, b) => b.rtime_last_played - a.rtime_last_played)
    .slice(0, 5)
    .map((game) => ({
      appid: game.appid || null,
      name: game.name,
      displayName: getDisplayName(game.name),
      lastPlayed: game.rtime_last_played || null,
      lastPlayedIso: toIso(game.rtime_last_played),
    }));

  return latest;
}

function getRecentFeedGame(games, debugInfo) {
  const latestRecent = games[0];
  debugInfo.sources.recentFeed.firstGame = latestRecent
    ? {
        appid: latestRecent.appid || null,
        name: latestRecent.name,
        displayName: getDisplayName(latestRecent.name),
        lastPlayed: latestRecent.rtime_last_played || null,
        lastPlayedIso: toIso(latestRecent.rtime_last_played),
      }
    : null;

  debugInfo.sources.recentFeed.topGames = games.slice(0, 5).map((game) => ({
    appid: game.appid || null,
    name: game.name,
    displayName: getDisplayName(game.name),
    lastPlayed: game.rtime_last_played || null,
    lastPlayedIso: toIso(game.rtime_last_played),
  }));

  return latestRecent;
}

export async function handler(event = {}) {
  const debug = isDebugRequest(event);
  const key = process.env.STEAM_API_KEY;
  const steamid = process.env.STEAM_ID64;
  const debugInfo = {
    generatedAt: new Date().toISOString(),
    env: {
      hasSteamApiKey: Boolean(key),
      hasSteamId64: Boolean(steamid),
      hasSteamProfileUrl: Boolean(process.env.STEAM_PROFILE_URL),
      steamProfileUrl: STEAM_PROFILE_URL,
    },
    selectedSource: null,
    sources: {},
  };

  if (!key || !steamid) {
    return send(
      500,
      { error: "Missing STEAM_API_KEY or STEAM_ID64" },
      debug,
      debugInfo
    );
  }

  try {
    debugInfo.sources.current = { attempted: true };
    const sRes = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamid}`
    );
    debugInfo.sources.current.ok = sRes.ok;
    debugInfo.sources.current.status = sRes.status || null;

    const sJson = await sRes.json();
    const player = sJson?.response?.players?.[0];
    debugInfo.sources.current.gameextrainfo = player?.gameextrainfo || null;

    if (player?.gameextrainfo) {
      debugInfo.selectedSource = "current";
      return send(
        200,
        { playing: getDisplayName(player.gameextrainfo), mode: "now" },
        debug,
        debugInfo
      );
    }

    const profileRecent = await getProfileRecentGame(debugInfo);
    if (profileRecent?.name) {
      debugInfo.selectedSource = "profile";
      return send(
        200,
        {
          playing: getDisplayName(profileRecent.name),
          mode: "profile",
          appid: profileRecent.appid,
          lastPlayed: null,
        },
        debug,
        debugInfo
      );
    }

    debugInfo.sources.ownedGames = { attempted: true };
    const gRes = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1`
    );
    debugInfo.sources.ownedGames.ok = gRes.ok;
    debugInfo.sources.ownedGames.status = gRes.status || null;

    if (gRes.ok) {
      const gJson = await gRes.json();
      const games = gJson?.response?.games || [];
      debugInfo.sources.ownedGames.count = games.length;
      debugInfo.sources.ownedGames.containsOath = games.some(
        (game) => String(game.appid) === "3104030" || String(game.name || "").toLowerCase() === "oath"
      );

      const latest = getLatestOwnedGame(games, debugInfo);

      if (latest?.name) {
        debugInfo.selectedSource = "ownedGames";
        return send(
          200,
          {
            playing: getDisplayName(latest.name),
            mode: "last",
            lastPlayed: latest.rtime_last_played || null,
          },
          debug,
          debugInfo
        );
      }
    }

    debugInfo.sources.recentFeed = { attempted: true };
    const recentRes = await fetch(
      `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${key}&steamid=${steamid}`
    );
    debugInfo.sources.recentFeed.ok = recentRes.ok;
    debugInfo.sources.recentFeed.status = recentRes.status || null;

    if (recentRes.ok) {
      const recentJson = await recentRes.json();
      const recentGames = recentJson?.response?.games || [];
      debugInfo.sources.recentFeed.count = recentGames.length;
      const latestRecent = getRecentFeedGame(recentGames, debugInfo);

      if (latestRecent?.name) {
        debugInfo.selectedSource = "recentFeed";
        return send(
          200,
          {
            playing: getDisplayName(latestRecent.name),
            mode: "recent",
            lastPlayed: latestRecent.rtime_last_played || null,
          },
          debug,
          debugInfo
        );
      }
    }

    debugInfo.selectedSource = "unknown";
    return send(
      200,
      {
        playing: null,
        mode: "unknown",
        lastPlayed: null,
      },
      debug,
      debugInfo
    );
  } catch (e) {
    debugInfo.error = e?.name || "Error";
    return send(500, { error: "Steam fetch failed" }, debug, debugInfo);
  }
}
