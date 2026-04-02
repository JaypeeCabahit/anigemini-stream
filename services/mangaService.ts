import { cachedFetch } from './cacheService';
import type { Manga, MangaChapter, MangaPage } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001/api';
const DEFAULT_POSTER = 'https://placehold.co/600x900?text=Manga';

interface Pagination {
  last_visible_page: number;
  has_next_page: boolean;
  current_page: number;
}

interface MangaListResponse {
  data: Manga[];
  pagination: Pagination;
}

const DEFAULT_PAGINATION: Pagination = {
  last_visible_page: 1,
  has_next_page: false,
  current_page: 1,
};

const fmtDate = (date?: { year?: number; month?: number; day?: number }) => {
  if (!date?.year) return undefined;
  const m = String(date.month ?? 1).padStart(2, '0');
  const d = String(date.day ?? 1).padStart(2, '0');
  return `${date.year}-${m}-${d}`;
};

const normalizeAniListManga = (raw: any): Manga => {
  const poster =
    raw?.coverImage?.extraLarge ||
    raw?.coverImage?.large ||
    raw?.coverImage?.medium ||
    DEFAULT_POSTER;
  const banner = raw?.bannerImage || poster;

  return {
    id: raw?.id ?? raw?.idMal,
    mal_id: raw?.id ?? raw?.idMal ?? raw?.mal_id ?? '',
    title: raw?.title?.english || raw?.title?.romaji || raw?.title?.native || 'Unknown',
    title_english: raw?.title?.english,
    title_romaji: raw?.title?.romaji,
    title_native: raw?.title?.native,
    images: {
      jpg: {
        image_url: poster,        // portrait cover — always use this for cards
        large_image_url: banner,  // landscape banner — use for heroes/details
      },
    },
    synopsis: raw?.description?.replace(/<[^>]+>/g, '') || '',
    score: raw?.averageScore != null ? raw.averageScore / 10 : raw?.score ?? null,
    rank: raw?.rank,
    status: raw?.status || '',
    type: raw?.format || 'Manga',
    chapters: raw?.chapters ?? null,
    volumes: raw?.volumes ?? null,
    genres: Array.isArray(raw?.genres)
      ? raw.genres.map((g: string) => ({ mal_id: 0, name: g }))
      : [],
    authors: Array.isArray(raw?.authors)
      ? raw.authors.map((a: any) => ({ mal_id: a?.id ?? 0, name: a?.name ?? '' }))
      : [],
    published: {
      from: fmtDate(raw?.startDate),
      to: fmtDate(raw?.endDate),
      string: raw?.startDate?.year ? String(raw.startDate.year) : undefined,
    },
    countryOfOrigin: raw?.countryOfOrigin,
    synonyms: raw?.synonyms ?? [],
    scraper_id: raw?.scraperId,
  };
};

const isMostlyLatin = (value: string | undefined) => {
  const normalized = String(value || '').replace(/[\s\d\p{P}]/gu, '');
  if (!normalized) return false;
  const latinChars = (normalized.match(/\p{Script=Latin}/gu) || []).length;
  return latinChars / normalized.length >= 0.6;
};

const normalizeScraperManga = (raw: any): Manga => {
  const cover = raw?.coverImage || raw?.thumbnail || DEFAULT_POSTER;
  const pickRomaji =
    raw?.altNames?.find((n: string) => isMostlyLatin(n) && n.trim() !== raw?.title)?.trim() ||
    raw?.title;
  const pickNative =
    raw?.altNames?.find((n: string) => n.trim() && !isMostlyLatin(n)) ||
    raw?.altNames?.find((n: string) => n.trim() !== raw?.title);

  return {
    id: raw?.id,
    mal_id: raw?.id ?? raw?.mal_id ?? '',
    title: raw?.title || 'Unknown',
    title_english: raw?.title,
    title_romaji: pickRomaji,
    title_native: pickNative,
    images: {
      jpg: {
        image_url: cover,
        large_image_url: cover,
      },
    },
    synopsis: raw?.synopsis || '',
    status: raw?.status || 'Unknown',
    type: 'Manga',
    chapters: Array.isArray(raw?.chapters) ? raw.chapters.length : raw?.chapters ?? null,
    volumes: raw?.volumes ?? null,
    genres: Array.isArray(raw?.genres)
      ? raw.genres.map((g: string) => ({ mal_id: 0, name: g }))
      : [],
    authors: raw?.author ? [{ mal_id: 0, name: raw.author }] : [],
    published: { string: raw?.published?.string ?? '' },
    countryOfOrigin: raw?.countryOfOrigin ?? 'JP',
    synonyms: raw?.altNames ?? [],
    scraper_id: raw?.scraper_id ?? raw?.id,
    latestChapter: raw?.latestChapter,
    source: raw?.source,
  };
};

const mapAniListPagination = (pageInfo?: any): Pagination => ({
  last_visible_page: pageInfo?.lastPage ?? 1,
  has_next_page: pageInfo?.hasNextPage ?? false,
  current_page: pageInfo?.currentPage ?? 1,
});

const fetchAniListList = async (endpoint: string, cacheKey: string): Promise<MangaListResponse> =>
  cachedFetch(
    cacheKey,
    async () => {
      const res = await fetch(`${API_BASE}${endpoint}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const media: any[] = Array.isArray(data?.media) ? data.media : [];
      return {
        data: media.map(normalizeAniListManga),
        pagination: mapAniListPagination(data?.pageInfo),
      };
    },
    'anime'
  );

const mapSimplePagination = (input: any, currentPage: number): Pagination => ({
  last_visible_page:
    input?.last_visible_page ??
    input?.total_pages ??
    input?.pageInfo?.lastPage ??
    input?.lastPage ??
    currentPage,
  has_next_page:
    input?.has_next_page ??
    (input?.total_pages ? currentPage < input.total_pages : false) ??
    input?.hasNextPage ??
    false,
  current_page: input?.current_page ?? input?.pageInfo?.currentPage ?? currentPage,
});

export const getSpotlight = async (): Promise<Manga[]> =>
  cachedFetch(
    'manga-spotlight',
    async () => {
      const res = await fetch(`${API_BASE}/manga/spotlight`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: any[] = Array.isArray(data?.data) ? data.data : [];
      return items.map(raw => {
        const m = normalizeAniListManga(raw);
        if (raw.scraperId) m.scraper_id = raw.scraperId;
        return m;
      });
    },
    'anime'
  );

export const getTrendingManga = (page = 1) =>
  fetchAniListList(`/anilist/trending/manga?page=${page}`, `manga-trending-${page}`);

export const getTopManga = (page = 1) =>
  fetchAniListList(`/anilist/top/manga?page=${page}`, `manga-top-${page}`);

export const getPopularManga = (page = 1) =>
  fetchAniListList(`/anilist/popular/manga?page=${page}`, `manga-popular-${page}`);

export const getPopularManhwa = (page = 1) =>
  fetchAniListList(`/anilist/top/manhwa?page=${page}`, `manga-manhwa-${page}`);

export const getOneShotManga = (page = 1) =>
  fetchAniListList(`/anilist/top/one-shot?page=${page}`, `manga-one-shot-${page}`);

export const searchManga = async (
  query: string,
  page = 1,
  limit = 18
): Promise<MangaListResponse> => {
  const trimmed = query.trim();
  if (!trimmed) return { data: [], pagination: { ...DEFAULT_PAGINATION } };

  return cachedFetch(
    `manga-search-${trimmed}-${page}-${limit}`,
    async () => {
      const res = await fetch(
        `${API_BASE}/anilist/search/manga?q=${encodeURIComponent(trimmed)}&page=${page}&limit=${limit}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const media: any[] = Array.isArray(data?.media) ? data.media : [];
      return {
        data: media.map(normalizeAniListManga),
        pagination: mapAniListPagination(data?.pageInfo),
      };
    },
    'search'
  );
};

export const searchMangaScraper = async (
  query: string,
  page = 1,
  limit = 18
): Promise<MangaListResponse> => {
  const trimmed = query.trim();
  if (!trimmed) return { data: [], pagination: { ...DEFAULT_PAGINATION } };

  const allResults = await cachedFetch(
    `manga-scraper-search-${trimmed}`,
    async () => {
      const res = await fetch(`${API_BASE}/manga/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) return [];
      const json = await res.json();
      const items = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      return items as any[];
    },
    'search'
  );

  const safeLimit = Math.max(1, limit);
  const total = allResults.length;
  const lastPage = Math.max(1, Math.ceil(total / safeLimit));
  const currentPage = Math.min(Math.max(page, 1), lastPage);
  const start = (currentPage - 1) * safeLimit;
  const slice = allResults.slice(start, start + safeLimit).map(normalizeScraperManga);

  return {
    data: slice,
    pagination: {
      last_visible_page: lastPage,
      current_page: currentPage,
      has_next_page: currentPage < lastPage,
    },
  };
};

export const getLatestManga = async (page = 1): Promise<MangaListResponse> =>
  cachedFetch(
    `manga-latest-${page}`,
    async () => {
      const res = await fetch(`${API_BASE}/manga/latest?page=${page}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: any[] = Array.isArray(data?.data) ? data.data : [];
      return {
        data: items.map((i) => normalizeScraperManga({ ...i, id: i.id ?? i.mal_id })),
        pagination: mapSimplePagination(data?.pagination, page),
      };
    },
    'anime'
  );

export const getNewManga = async (page = 1): Promise<MangaListResponse> =>
  cachedFetch(
    `manga-new-${page}`,
    async () => {
      const res = await fetch(`${API_BASE}/manga/new-manga?page=${page}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: any[] = Array.isArray(data?.data) ? data.data : [];
      return {
        data: items.map((i) => normalizeScraperManga({ ...i, id: i.id ?? i.mal_id })),
        pagination: mapSimplePagination(data?.pagination, page),
      };
    },
    'anime'
  );

export const getMangaDirectory = async (page = 1): Promise<MangaListResponse> =>
  cachedFetch(
    `manga-directory-${page}`,
    async () => {
      const res = await fetch(`${API_BASE}/manga/directory?page=${page}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: any[] = Array.isArray(data?.data) ? data.data : [];
      return {
        data: items.map((i) => normalizeScraperManga({ ...i, id: i.id ?? i.mal_id })),
        pagination: mapSimplePagination(data?.pagination, page),
      };
    },
    'anime'
  );

export const getHotUpdates = async (): Promise<any[]> =>
  cachedFetch(
    'manga-hot-updates',
    async () => {
      const res = await fetch(`${API_BASE}/manga/hot-updates`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.data) ? data.data : [];
    },
    'anime'
  );

export const getUnifiedMangaDetails = async (id: string | number): Promise<Manga | null> =>
  cachedFetch(
    `manga-details-${id}`,
    async () => {
      const res = await fetch(`${API_BASE}/manga/details/${encodeURIComponent(String(id))}`);
      if (!res.ok) return null;
      const json = await res.json();
      const data = json?.data;
      if (!data) return null;

      if (data.title && typeof data.title === 'object') {
        const mapped = normalizeAniListManga(data);
        if (typeof data.scraperId === 'string') {
          mapped.scraper_id = data.scraperId;
        }
        return mapped;
      }

      return normalizeScraperManga(data);
    },
    'anime'
  );

export const getChapters = async (mangaId: string): Promise<MangaChapter[]> =>
  cachedFetch(
    `manga-chapters-${mangaId}`,
    async () => {
      const res = await fetch(`${API_BASE}/manga/chapters/${encodeURIComponent(mangaId)}`);
      if (!res.ok) return [];
      const data = await res.json();
      const chapters: any[] = Array.isArray(data?.chapters) ? data.chapters : [];
      return chapters.map((c, idx) => ({
        id: c?.id ?? String(idx + 1),
        title: c?.title || `Chapter ${idx + 1}`,
        url: c?.url || '',
        uploadDate: c?.uploadDate || c?.date,
      }));
    },
    'episodes'
  );

// Uses /api/manga/details/:id which resolves scraperId via mapping service
export const getMangaByAnilistId = async (id: string | number): Promise<Manga | null> =>
  cachedFetch(
    `manga-anilist-${id}`,
    async () => {
      const res = await fetch(`${API_BASE}/manga/details/${id}`);
      if (!res.ok) return null;
      const json = await res.json();
      const data = json?.data;
      if (!data) return null;
      // AniList response has title as object; scraper response has title as string
      const manga = typeof data.title === 'object'
        ? normalizeAniListManga(data)
        : normalizeScraperManga(data);
      if (data.scraperId) manga.scraper_id = data.scraperId;
      return manga;
    },
    'anime'
  );

let _randomMangaPool: string[] = [];
export const getRandomManga = async (): Promise<string | null> => {
  if (_randomMangaPool.length > 0) return _randomMangaPool.shift()!;
  try {
    const page = Math.floor(Math.random() * 30) + 1;
    const res = await fetch(`${API_BASE}/anilist/popular/manga?page=${page}&limit=10`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const ids: string[] = (Array.isArray(data?.media) ? data.media : [])
      .map((m: any) => String(m.id))
      .filter(Boolean);
    if (ids.length === 0) throw new Error();
    _randomMangaPool = ids.slice(1);
    return ids[0];
  } catch {
    return null;
  }
};

export const getChapterPages = async (chapterUrl: string): Promise<MangaPage[]> =>
  cachedFetch(
    `manga-pages-${chapterUrl}`,
    async () => {
      const res = await fetch(`${API_BASE}/manga/pages?url=${encodeURIComponent(chapterUrl)}`);
      if (!res.ok) return [];
      const data = await res.json();
      const pages: any[] = Array.isArray(data?.pages) ? data.pages : [];
      return pages.map((p, idx) => ({
        pageNumber: p?.pageNumber ?? idx + 1,
        imageUrl: p?.imageUrl || p?.url || '',
      }));
    },
    'episodes'
  );
