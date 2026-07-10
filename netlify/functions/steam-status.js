import { getStore } from "@netlify/blobs";

const NAME_ALIASES = {
  "Source SDK Base 2007": "FiveM",
};

const STEAM_PROFILE_URL = process.env.STEAM_PROFILE_URL || "https://steamcommunity.com/id/Starworshipp3r";
const CACHE_STORE = "steam-status";
const CACHE_KEY = "last-good";
const CACHE_TTL_MS = Number(process.env.STEAM_STATUS_CACHE_TTL_MS || 2 * 60 * 60 * 1000);
const STALE_TTL_MS = Number(process.env.STEAM_STATUS_STALE_TTL_MS || 7 * 24 * 60 * 60 * 1000);

function getQueryParam(input, name) {
  if (input?.queryStringParameters) return input.queryStringParameters[name];

  try {
    return input?.url ? new URL(input.url).searchParams.get(name) : null;
  } catch {
    return null;
  }
}

function isTruthyParam(input, name) {
  const value = getQueryParam(input, name);
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
  return new Response(JSON.stringify(debug ? { ...payload, debug: debugInfo } : payload), {
    status: statusCode,
    headers: getHeaders(debug),
  });
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

function getAgeMs(value, now = Date.now()) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? now - time : null;
}

function isTrustedCachedPayload(payload) {
  return ["now", "profile"].includes(payload?.mode);
}

function getCacheState(record, now = Date.now()) {
  const hasPayload = Boolean(record?.payload?.playing) && isTrustedCachedPayload(record.payload);
  const cachedAgeMs = getAgeMs(record?.cachedAt, now);
  const checkedAgeMs = getAgeMs(record?.checkedAt || record?.cachedAt, now);
  const withinStaleWindow = hasPayload && cachedAgeMs !== null && cachedAgeMs <= STALE_TTL_MS;
  const fresh = withinStaleWindow && checkedAgeMs !== null && checkedAgeMs <= CACHE_TTL_MS;

  return {
    hasPayload,
    cachedAgeMs,
    checkedAgeMs,
    withinStaleWindow,
    fresh,
  };
}

function sanitizeCachedPayload(payload) {
  return {
    playing: payload?.playing || null,
    mode: payload?.mode || "cache",
    appid: payload?.appid || null,
    lastPlayed: payload?.lastPlayed || null,
  };
}

async function readCachedStatus(debugInfo) {
  debugInfo.cache = {
    store: CACHE_STORE,
    key: CACHE_KEY,
    cacheTtlMs: CACHE_TTL_MS,
    staleTtlMs: STALE_TTL_MS,
    readAttempted: true,
  };

  try {
    const store = getStore(CACHE_STORE);
    const record = await store.get(CACHE_KEY, { type: "json" });
    const state = getCacheState(record);

    debugInfo.cache.hit = Boolean(record);
    debugInfo.cache.state = state;
    debugInfo.cache.record = record
      ? {
          payload: sanitizeCachedPayload(record.payload),
          cachedAt: record.cachedAt || null,
          checkedAt: record.checkedAt || null,
          lastError: record.lastError || null,
          trusted: isTrustedCachedPayload(record.payload),
        }
      : null;

    return record;
  } catch (error) {
    debugInfo.cache.hit = false;
    debugInfo.cache.error = error?.name || "Error";
    debugInfo.cache.reason = error?.message || "Blob cache read failed";
    return null;
  }
}

async function writeCachedStatus(record, debugInfo, reason) {
  debugInfo.cache.writeAttempted = true;
  debugInfo.cache.writeReason = reason;

  try {
    const store = getStore(CACHE_STORE);
    await store.setJSON(CACHE_KEY, record);
    debugInfo.cache.writeOk = true;
  } catch (error) {
    debugInfo.cache.writeOk = false;
    debugInfo.cache.writeError = error?.name || "Error";
    debugInfo.cache.writeFailureReason = error?.message || "Blob cache write failed";
  }
}

async function writeGoodCache(payload, debugInfo, reason) {
  const now = new Date().toISOString();
  const record = {
    version: 1,
    payload: sanitizeCachedPayload(payload),
    cachedAt: now,
    checkedAt: now,
    lastError: null,
  };

  await writeCachedStatus(record, debugInfo, reason);
}

async function markCacheChecked(record, debugInfo, source, sourceDebug) {
  if (!record?.payload?.playing) return;

  const nextRecord = {
    ...record,
    checkedAt: new Date().toISOString(),
    lastError: {
      source,
      status: sourceDebug?.status || null,
      reason: sourceDebug?.reason || sourceDebug?.error || "refresh failed",
      at: new Date().toISOString(),
    },
  };

  await writeCachedStatus(nextRecord, debugInfo, "refresh-failed");
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

function shouldReturnCache(record, forceRefresh, debugInfo) {
  const state = getCacheState(record);
  debugInfo.cache.state = state;

  return !forceRefresh && state.fresh;
}

function canReturnStaleCache(record, debugInfo) {
  const state = getCacheState(record);
  debugInfo.cache.state = state;

  return state.withinStaleWindow;
}

export default async function handler(request = {}) {
  const debug = isTruthyParam(request, "debug");
  const forceRefresh = isTruthyParam(request, "refresh");
  const key = process.env.STEAM_API_KEY;
  const steamid = process.env.STEAM_ID64;
  const debugInfo = {
    generatedAt: new Date().toISOString(),
    request: {
      debug,
      forceRefresh,
    },
    env: {
      hasSteamApiKey: Boolean(key),
      hasSteamId64: Boolean(steamid),
      hasSteamProfileUrl: Boolean(process.env.STEAM_PROFILE_URL),
      steamProfileUrl: STEAM_PROFILE_URL,
    },
    selectedSource: null,
    sources: {},
  };

  const cachedRecord = await readCachedStatus(debugInfo);
  if (shouldReturnCache(cachedRecord, forceRefresh, debugInfo)) {
    debugInfo.selectedSource = "cacheFresh";
    debugInfo.cache.returned = "fresh";
    return send(200, sanitizeCachedPayload(cachedRecord.payload), debug, debugInfo);
  }

  if (!key || !steamid) {
    if (canReturnStaleCache(cachedRecord, debugInfo)) {
      debugInfo.selectedSource = "cacheStale";
      debugInfo.cache.returned = "stale-missing-env";
      return send(200, sanitizeCachedPayload(cachedRecord.payload), debug, debugInfo);
    }

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

    const sJson = sRes.ok ? await sRes.json() : null;
    const player = sJson?.response?.players?.[0];
    debugInfo.sources.current.gameextrainfo = player?.gameextrainfo || null;

    if (player?.gameextrainfo) {
      const payload = {
        playing: getDisplayName(player.gameextrainfo),
        mode: "now",
        appid: null,
        lastPlayed: null,
      };

      debugInfo.selectedSource = "current";
      await writeGoodCache(payload, debugInfo, "current");
      return send(200, payload, debug, debugInfo);
    }

    const profileRecent = await getProfileRecentGame(debugInfo);
    if (profileRecent?.name) {
      const payload = {
        playing: getDisplayName(profileRecent.name),
        mode: "profile",
        appid: profileRecent.appid,
        lastPlayed: null,
      };

      debugInfo.selectedSource = "profile";
      await writeGoodCache(payload, debugInfo, "profile");
      return send(200, payload, debug, debugInfo);
    }

    if (canReturnStaleCache(cachedRecord, debugInfo)) {
      await markCacheChecked(cachedRecord, debugInfo, "profile", debugInfo.sources.profile);
      debugInfo.selectedSource = "cacheStale";
      debugInfo.cache.returned = "stale-refresh-failed";
      return send(200, sanitizeCachedPayload(cachedRecord.payload), debug, debugInfo);
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
            appid: latest.appid || null,
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
            appid: latestRecent.appid || null,
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
        appid: null,
        lastPlayed: null,
      },
      debug,
      debugInfo
    );
  } catch (e) {
    if (canReturnStaleCache(cachedRecord, debugInfo)) {
      await markCacheChecked(cachedRecord, debugInfo, "exception", { error: e?.name || "Error" });
      debugInfo.selectedSource = "cacheStale";
      debugInfo.cache.returned = "stale-exception";
      return send(200, sanitizeCachedPayload(cachedRecord.payload), debug, debugInfo);
    }

    debugInfo.error = e?.name || "Error";
    return send(500, { error: "Steam fetch failed" }, debug, debugInfo);
  }
}
