import { Anime } from '../types';
import { cachedFetch } from './cacheService';

const API_BASE = `${import.meta.env.VITE_API_BASE ?? 'http://localhost:3001/api'}/anilist`;
const DEFAULT_POSTER = 'https://placehold.co/600x900?text=No+Image';

export interface Character {
  character: {
    mal_id: number;
    name: string;
    images: { jpg: { image_url: string } };
  };
  role: string;
  voice_actors: {
    person: { name: string };
    language: string;
  }[];
}

export interface PaginationData {
  last_visible_page: number;
  has_next_page: boolean;
  current_page: number;
  items: { count: number; total: number; per_page: number };
}

export interface ApiResponse {
  data: Anime[];
  pagination: PaginationData;
}

const DEFAULT_PAGINATION: PaginationData = {
  last_visible_page: 1,
  has_next_page: false,
  current_page: 1,
  items: { count: 0, total: 0, per_page: 0 },
};

const normalizeAnime = (raw: any): Anime => {
  const poster =
    raw?.coverImage?.extraLarge ||
    raw?.coverImage?.large ||
    raw?.bannerImage ||
    DEFAULT_POSTER;

  const title =
    raw?.title?.english ||
    raw?.title?.romaji ||
    raw?.title?.native ||
    'Unknown Title';

  const startDate = raw?.startDate;
  const airedFrom = startDate?.year
    ? `${startDate.year}-${String(startDate.month ?? 1).padStart(2, '0')}-${String(startDate.day ?? 1).padStart(2, '0')}`
    : '';

  const score = raw?.averageScore != null ? raw.averageScore / 10 : null;
  const genres: { name: string }[] = Array.isArray(raw?.genres)
    ? raw.genres.map((g: string) => ({ name: g }))
    : [];

  const statusMap: Record<string, string> = {
    FINISHED: 'Finished Airing',
    RELEASING: 'Currently Airing',
    NOT_YET_RELEASED: 'Not yet aired',
    CANCELLED: 'Cancelled',
    HIATUS: 'On Hiatus',
  };

  let mappedStatus = statusMap[raw?.status] || raw?.status || '';

  // Heuristic: if AniList says "Not yet aired" but the start date is already in the past,
  // the show is likely airing (data lag on AniList side).
  if (mappedStatus === 'Not yet aired' && startDate?.year) {
    const today = new Date();
    const airDate = new Date(
      startDate.year,
      (startDate.month ?? 1) - 1,
      startDate.day ?? 1
    );
    if (airDate <= today) {
      mappedStatus = 'Currently Airing';
    }
  }

  return {
    mal_id: String(raw?.id ?? raw?.idMal ?? ''),
    title,
    images: {
      jpg: { image_url: poster, large_image_url: poster },
      webp: { image_url: poster, large_image_url: poster },
    },
    trailer: {
      youtube_id: '',
      url: '',
      embed_url: '',
      images: {
        image_url: poster,
        small_image_url: poster,
        medium_image_url: poster,
        large_image_url: raw?.bannerImage || poster,
        maximum_image_url: raw?.bannerImage || poster,
      },
    },
    synopsis: raw?.description?.replace(/<[^>]+>/g, '') || '',
    score,
    year: raw?.seasonYear ?? raw?.startDate?.year ?? null,
    aired: airedFrom
      ? { from: airedFrom, to: '', string: airedFrom }
      : undefined,
    episodes: raw?.episodes ?? 0,
    status: mappedStatus,
    genres,
    rating: raw?.isAdult ? 'R+ - Mild Nudity' : '',
    type: raw?.format || 'TV',
    duration: raw?.duration ? `${raw.duration} min` : '',
    rank: undefined,
    // Extra title data for EN/JP toggle (not part of base Anime type but cast-safe)
    _titles: {
      english: raw?.title?.english ?? null,
      romaji: raw?.title?.romaji ?? null,
      native: raw?.title?.native ?? null,
    },
  } as any;
};

const normalizeScheduleAnime = (raw: any): Anime => {
  const poster =
    raw?.coverImage?.extraLarge ||
    raw?.coverImage?.large ||
    DEFAULT_POSTER;

  const title =
    raw?.title?.english ||
    raw?.title?.romaji ||
    raw?.title?.native ||
    'Unknown Title';

  return {
    mal_id: String(raw?.idMal ?? raw?.id ?? ''),
    title,
    images: {
      jpg: { image_url: poster, large_image_url: poster },
      webp: { image_url: poster, large_image_url: poster },
    },
    trailer: {
      youtube_id: '',
      url: '',
      embed_url: '',
      images: {
        image_url: poster,
        small_image_url: poster,
        medium_image_url: poster,
        large_image_url: poster,
        maximum_image_url: poster,
      },
    },
    synopsis: '',
    score: null,
    year: null,
    episodes: 0,
    status: '',
    genres: [],
    rating: '',
    type: raw?.format || 'TV',
    duration: '',
    rank: undefined,
    _titles: {
      english: raw?.title?.english ?? null,
      romaji: raw?.title?.romaji ?? null,
      native: raw?.title?.native ?? null,
    },
  } as any;
};

const mapPageInfo = (pageInfo?: any): PaginationData => ({
  last_visible_page: pageInfo?.lastPage ?? 1,
  has_next_page: pageInfo?.hasNextPage ?? false,
  current_page: pageInfo?.currentPage ?? 1,
  items: {
    count: pageInfo?.total ?? 0,
    total: pageInfo?.total ?? 0,
    per_page: 24,
  },
});

const fetchList = async (endpoint: string): Promise<ApiResponse> => {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const media: any[] = Array.isArray(data?.media) ? data.media : [];
    return {
      data: media.map(normalizeAnime),
      pagination: mapPageInfo(data?.pageInfo),
    };
  } catch (err) {
    console.error(`AniList fetch error (${endpoint}):`, err);
    return { data: [], pagination: { ...DEFAULT_PAGINATION } };
  }
};

export const getTopAnime = (page = 1) =>
  cachedFetch(
    `anilist-trending-${page}`,
    () => fetchList(`/trending?page=${page}&limit=24`),
    'anime'
  );

export const getPopularAnime = (page = 1) =>
  cachedFetch(
    `anilist-popular-${page}`,
    () => fetchList(`/popular?page=${page}&limit=24`),
    'anime'
  );

export const getSeasonalAnime = (page = 1) =>
  cachedFetch(
    `anilist-seasonal-${page}`,
    () => fetchList(`/popular-this-season?page=${page}&limit=24`),
    'anime'
  );

export const searchAnime = async (query: string, page = 1): Promise<ApiResponse> => {
  if (!query) return { data: [], pagination: { ...DEFAULT_PAGINATION } };
  try {
    return await cachedFetch(
      `anilist-search-${query}-${page}`,
      () => fetchList(`/search?q=${encodeURIComponent(query)}&page=${page}&limit=24`),
      'search'
    );
  } catch (err) {
    console.error('AniList search error:', err);
    return { data: [], pagination: { ...DEFAULT_PAGINATION } };
  }
};

export const getAnimeDetails = async (id: string): Promise<Anime | null> => {
  try {
    return await cachedFetch(
      `anilist-details-${id}`,
      async () => {
        const res = await fetch(`${API_BASE}/anime/${id}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data?.id ? normalizeAnime(data) : null;
      },
      'anime'
    );
  } catch (err) {
    console.error('AniList details error:', err);
    return null;
  }
};

export interface AnimeFastResult {
  anime: Anime;
  episodes: import('./streamingService').Episode[];
  scraperSession: string | null;
}

export interface AiringScheduleItem {
  id: string;
  airingAt: number; // unix seconds
  episode: number;
  media: Anime;
}

export const getAnimeFast = async (id: string): Promise<AnimeFastResult | null> => {
  try {
    const res = await fetch(`${API_BASE}/anime/${id}/fast`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.anime) return null;

    const anime = normalizeAnime(data.anime);
    const scraperSession: string | null = data.scraperSession ?? null;
    const rawEps: any[] = Array.isArray(data.episodes) ? data.episodes : [];
    const episodes = rawEps.map((ep: any) => ({
      id: `${scraperSession}||${ep.session}`,
      number: ep.episodeNumber || 0,
      url: ep.url || '',
    }));

    return { anime, episodes, scraperSession };
  } catch (err) {
    console.error('AniList fast error:', err);
    return null;
  }
};

export const getAnimeCharacters = async (_id?: string): Promise<Character[]> => {
  return [];
};

export const getAnimeRecommendations = async (id: string): Promise<Anime[]> => {
  try {
    const res = await fetch(`${API_BASE}/anime/${id}`);
    if (!res.ok) return [];
    const data = await res.json();
    const recs: any[] = Array.isArray(data?.recommendations?.nodes)
      ? data.recommendations.nodes
      : [];
    return recs
      .map((r: any) => r?.mediaRecommendation || r)
      .filter(Boolean)
      .slice(0, 10)
      .map(normalizeAnime);
  } catch {
    return [];
  }
};

// Titles: English + Japanese (romaji) stored on each anime
export interface TitleData {
  english: string | null;
  romaji: string | null;
  native: string | null;
}

export const getAnimeTitles = (anime: Anime): TitleData => ({
  english: (anime as any)._titles?.english ?? null,
  romaji: (anime as any)._titles?.romaji ?? anime.title,
  native: (anime as any)._titles?.native ?? null,
});

// Random anime — picks a random popular page and returns one anime ID
let _randomPool: string[] = [];
export const getRandomAnime = async (): Promise<string | null> => {
  if (_randomPool.length > 0) return _randomPool.shift()!;
  try {
    const randomPage = Math.floor(Math.random() * 30) + 1;
    const res = await fetch(`${API_BASE}/search?query=&sort=POPULARITY_DESC&page=${randomPage}&perPage=10`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const ids: string[] = (Array.isArray(data) ? data : data.data ?? [])
      .map((a: any) => String(a.mal_id || a.id))
      .filter(Boolean);
    if (ids.length === 0) throw new Error();
    _randomPool = ids.slice(1);
    return ids[0];
  } catch {
    // Fallback: known popular IDs
    const fallbacks = ['1535', '5114', '11061', '16498', '20', '21', '9253', '38000', '40748', '113415'];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
};

// Airing schedule (estimated upcoming episodes)
export const getAiringSchedule = async (start?: number, end?: number): Promise<AiringScheduleItem[]> => {
  const now = Math.floor(Date.now() / 1000);
  const startTs = start ?? now;
  const endTs = end ?? now + 7 * 86400;

  try {
    return await cachedFetch(
      `anilist-schedule-${startTs}-${endTs}`,
      async () => {
        const res = await fetch(`${API_BASE}/schedule?start=${startTs}&end=${endTs}`);
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data
          .filter((item: any) => item?.media)
          .map((item: any) => ({
            id: String(item.id ?? `${item.media?.id}-${item.airingAt}`),
            airingAt: item.airingAt ?? 0,
            episode: item.episode ?? 0,
            media: normalizeScheduleAnime(item.media),
          }));
      },
      'episodes'
    );
  } catch (err) {
    console.error('AniList schedule error:', err);
    return [];
  }
};
