export async function handler() {
  const key = process.env.LASTFM_API_KEY;
  const user = process.env.LASTFM_USER;

  if (!key || !user) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Missing LASTFM_API_KEY or LASTFM_USER" }),
    };
  }

  try {
    const period = "7day"; // try "1month" if you want slower changes

    const url =
      `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists` +
      `&user=${encodeURIComponent(user)}` +
      `&api_key=${encodeURIComponent(key)}` +
      `&period=${period}&limit=1&format=json`;

    const res = await fetch(url);
    const json = await res.json();

    const top = json?.topartists?.artist?.[0];
    const name = top?.name || null;
    const playcount = top?.playcount ? Number(top.playcount) : null;

    // Optional: require a minimum so it only changes when it's "real"
    const MIN_PLAYS = 8;
    const artist = (playcount != null && playcount >= MIN_PLAYS) ? name : name; // change to null if you want fallback

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=3600", // 1h is plenty for “weekly vibe”
      },
      body: JSON.stringify({ artist, playcount, period }),
    };
  } catch {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Last.fm fetch failed" }),
    };
  }
}
