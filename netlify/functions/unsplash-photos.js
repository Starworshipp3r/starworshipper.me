export async function handler(event) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  const username = process.env.UNSPLASH_USERNAME || 'starworshipp3r';

  if (!accessKey) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Missing UNSPLASH_ACCESS_KEY' }),
    };
  }

  const params = new URLSearchParams(event.queryStringParameters || {});
  const requestedCount = Number(params.get('count'));
  const count = Number.isFinite(requestedCount)
    ? Math.min(Math.max(Math.trunc(requestedCount), 1), 30)
    : 8;

  const url = new URL('https://api.unsplash.com/photos/random');
  url.searchParams.set('username', username);
  url.searchParams.set('count', String(count));
  url.searchParams.set('orientation', 'squarish');
  url.searchParams.set('content_filter', 'high');

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        'Accept-Version': 'v1',
      },
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Unsplash fetch failed', status: res.status }),
      };
    }

    const json = await res.json();
    const items = Array.isArray(json) ? json : [json];

    const photos = items.map((photo, index) => ({
      id: photo.id,
      src: photo.urls?.regular || photo.urls?.small || photo.urls?.full || null,
      thumb: photo.urls?.small || photo.urls?.thumb || photo.urls?.regular || null,
      title: photo.alt_description || photo.description || `Shot ${String(index + 1).padStart(2, '0')}`,
      meta: photo.user?.name || username,
      caption: photo.description || photo.alt_description || 'Freshly pulled from Unsplash.',
      photoPage: photo.links?.html || null,
      downloadLocation: photo.links?.download_location || null,
      userName: photo.user?.name || username,
      userProfile: photo.user?.links?.html || `https://unsplash.com/@${username}`,
    })).filter((photo) => photo.src);

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=300',
      },
      body: JSON.stringify({ photos, username, count: photos.length }),
    };
  } catch {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Unsplash request failed' }),
    };
  }
}
