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
    : 9;

  const headers = {
    Authorization: `Client-ID ${accessKey}`,
    'Accept-Version': 'v1',
  };

  try {
    const userUrl = new URL(`https://api.unsplash.com/users/${encodeURIComponent(username)}`);
    const userRes = await fetch(userUrl, { headers });

    if (!userRes.ok) {
      return {
        statusCode: userRes.status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'Unsplash user lookup failed',
          status: userRes.status,
          username,
          hint: userRes.status === 404
            ? 'Unsplash could not find that username, or the account is not API-visible.'
            : null,
        }),
      };
    }

    const user = await userRes.json();
    const totalPhotos = Number(user?.total_photos) || 0;
    const perPage = Math.max(count, 30);
    const totalPages = Math.max(1, Math.ceil(totalPhotos / perPage));
    const randomPage = Math.max(1, Math.floor(Math.random() * totalPages) + 1);

    const photosUrl = new URL(`https://api.unsplash.com/users/${encodeURIComponent(username)}/photos`);
    photosUrl.searchParams.set('per_page', String(perPage));
    photosUrl.searchParams.set('page', String(randomPage));
    photosUrl.searchParams.set('order_by', 'latest');
    photosUrl.searchParams.set('t', String(Date.now()));

    const res = await fetch(photosUrl, { headers });

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'Unsplash fetch failed',
          status: res.status,
          username,
          randomPage,
          totalPages,
        }),
      };
    }

    const items = await res.json();
    const pool = Array.isArray(items) ? items.slice() : [];
    let backfillPage = null;

    if (pool.length < count && totalPages > 1) {
      const fallbackPages = Array.from({ length: totalPages }, (_, index) => index + 1)
        .filter((page) => page !== randomPage);
      backfillPage = fallbackPages[Math.floor(Math.random() * fallbackPages.length)];

      const backfillUrl = new URL(photosUrl);
      backfillUrl.searchParams.set('page', String(backfillPage));
      backfillUrl.searchParams.set('t', String(Date.now()));

      const backfillRes = await fetch(backfillUrl, { headers });
      if (backfillRes.ok) {
        const backfillItems = await backfillRes.json();
        if (Array.isArray(backfillItems)) pool.push(...backfillItems);
      }
    }

    const uniquePool = [...new Map(pool.map((photo) => [photo.id, photo])).values()];

    for (let i = uniquePool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [uniquePool[i], uniquePool[j]] = [uniquePool[j], uniquePool[i]];
    }

    const photos = uniquePool.map((photo, index) => ({
      id: photo.id,
      src: photo.urls?.regular || photo.urls?.small || photo.urls?.full || null,
      thumb: photo.urls?.small || photo.urls?.thumb || photo.urls?.regular || null,
      title: photo.alt_description || photo.description || `Shot ${String(index + 1).padStart(2, '0')}`,
      meta: photo.user?.name || username,
      caption: photo.description || photo.alt_description || 'Freshly pulled from Unsplash.',
      photoPage: photo.links?.html || null,
      userName: photo.user?.name || username,
      userProfile: photo.user?.links?.html || `https://unsplash.com/@${username}`,
    })).filter((photo) => photo.src).slice(0, count);

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store, max-age=0',
      },
      body: JSON.stringify({ photos, username, count: photos.length, randomPage, backfillPage, totalPages, totalPhotos }),
    };
  } catch {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Unsplash request failed', username }),
    };
  }
}

