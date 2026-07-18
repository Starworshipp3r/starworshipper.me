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

    const artistUrl =
      `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists` +
      `&user=${encodeURIComponent(user)}` +
      `&api_key=${encodeURIComponent(key)}` +
      `&period=${period}&limit=1&format=json`;

    const albumUrl =
      `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums` +
      `&user=${encodeURIComponent(user)}` +
      `&api_key=${encodeURIComponent(key)}` +
      `&period=${period}&limit=50&format=json`;

    const [artistRes, albumRes] = await Promise.all([
      fetch(artistUrl),
      fetch(albumUrl),
    ]);

    if (!artistRes.ok) throw new Error("Last.fm artist fetch failed");

    const artistJson = await artistRes.json();
    const albumJson = albumRes.ok ? await albumRes.json() : null;

    const top = artistJson?.topartists?.artist?.[0];
    const name = top?.name || null;
    const playcount = top?.playcount ? Number(top.playcount) : null;

    const matchingAlbum = albumJson?.topalbums?.album?.find((album) => {
      const albumArtist = typeof album?.artist === "string"
        ? album.artist
        : album?.artist?.name;
      return albumArtist?.toLocaleLowerCase() === name?.toLocaleLowerCase();
    });

    const artwork = [...(matchingAlbum?.image || [])]
      .reverse()
      .map((image) => image?.["#text"])
      .find((url) => url && !url.includes("2a96cbd8b46e442fc41c2b86b821562f")) || null;

    // Optional: require a minimum so it only changes when it's "real"
    const MIN_PLAYS = 8;
    const artist = (playcount != null && playcount >= MIN_PLAYS) ? name : name; // change to null if you want fallback

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=3600", // 1h is plenty for “weekly vibe”
      },
      body: JSON.stringify({
        artist,
        playcount,
        period,
        artwork,
        album: matchingAlbum?.name || null,
      }),
    };
  } catch {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Last.fm fetch failed" }),
    };
  }
}
