import { cachedFetch } from './cacheService';

// Yorumi backend - run locally: cd "../Yorumi-main/Yorumi-main/backend" && npm run dev
const API_BASE_URL = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001/api';

export interface Episode {
  id: string;       // compound: "{animeSession}||{epSession}"
  number: number;
  url: string;
}

export interface StreamSource {
  headers: { Referer: string };
  sources: { url: string; isM3U8: boolean; quality: string }[];
  download: string;
  isEmbed: boolean; // true = Kwik iframe embed, false = direct HLS
}

export const getStreamEpisodes = async (animeSession: string): Promise<Episode[]> => {
  try {
    return await cachedFetch(
      `yorumi-eps-${animeSession}`,
      async () => {
        const response = await fetch(
          `${API_BASE_URL}/scraper/episodes?session=${encodeURIComponent(animeSession)}`
        );
        if (!response.ok) return [];
        const data = await response.json();
        const episodes = Array.isArray(data?.episodes) ? data.episodes : [];
        if (episodes.length === 0) return [];
        return episodes.map((ep: any) => ({
          // Encode both sessions so getStreamSource can split them later
          id: `${animeSession}||${ep.session}`,
          number: ep.episodeNumber || 0,
          url: ep.url || '',
        }));
      },
      'episodes'
    );
  } catch (error) {
    console.error('Yorumi Episodes Error', error);
    return [];
  }
};

export const getStreamSource = async (
  compoundEpisodeId: string
): Promise<StreamSource | null> => {
  try {
    return await cachedFetch(
      `yorumi-stream-${compoundEpisodeId}`,
      async () => {
        const separatorIndex = compoundEpisodeId.indexOf('||');
        if (separatorIndex === -1) return null;
        const animeSession = compoundEpisodeId.slice(0, separatorIndex);
        const epSession = compoundEpisodeId.slice(separatorIndex + 2);
        if (!animeSession || !epSession) return null;

        const response = await fetch(
          `${API_BASE_URL}/scraper/streams?anime_session=${encodeURIComponent(animeSession)}&ep_session=${encodeURIComponent(epSession)}`
        );
        if (!response.ok) return null;

        const streams = await response.json();
        if (!Array.isArray(streams) || streams.length === 0) return null;

        // Sort by quality descending, prefer sub over dub
        const sorted = [...streams].sort((a, b) => {
          const qa = parseInt(a.quality) || 0;
          const qb = parseInt(b.quality) || 0;
          if (qb !== qa) return qb - qa;
          if (a.audio === 'sub' && b.audio !== 'sub') return -1;
          if (b.audio === 'sub' && a.audio !== 'sub') return 1;
          return 0;
        });

        const isEmbed = !sorted[0]?.isHls;

        return {
          headers: { Referer: 'https://animepahe.ru/' },
          sources: sorted.map((s: any) => ({
            url: s.url,
            isM3U8: !!s.isHls,
            quality: s.quality || 'default',
          })),
          download: '',
          isEmbed,
        };
      },
      'stream'
    );
  } catch (error) {
    console.error('Yorumi Stream Error', error);
    return null;
  }
};
