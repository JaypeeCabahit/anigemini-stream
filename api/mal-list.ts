const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const username = (req.query.username as string | undefined)?.trim();
  if (!username) {
    res.status(400).json({ error: 'username is required' });
    return;
  }

  const status = (req.query.status as string | undefined) ?? '7'; // 7 = all
  const maxLoops = 20; // safety cap (~6000 entries)
  let offset = 0;
  const all: any[] = [];

  try {
    for (let i = 0; i < maxLoops; i++) {
      const url = `https://myanimelist.net/animelist/${encodeURIComponent(username)}/load.json?offset=${offset}&status=${status}`;
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) {
        const txt = await r.text();
        const msg = txt && txt.length < 400 ? txt : r.statusText;
        res.status(r.status === 404 ? 404 : 502).json({ error: msg || 'Failed to fetch MAL list' });
        return;
      }
      const chunk = (await r.json()) as any[];
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      all.push(...chunk);
      if (chunk.length < 300) break;
      offset += chunk.length;
      await delay(250); // be kind
    }

    res.status(200).json({ data: all, count: all.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unexpected error' });
  }
}
