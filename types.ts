export interface Anime {
  mal_id: string;
  title: string;
  images: {
    jpg: {
      image_url: string;
      large_image_url: string;
    };
    webp: {
      image_url: string;
      large_image_url: string;
    };
  };
  trailer: {
    youtube_id: string;
    url: string;
    embed_url: string;
    images: {
      image_url: string;
      small_image_url: string;
      medium_image_url: string;
      large_image_url: string;
      maximum_image_url: string;
    };
  };
  synopsis: string;
  score: number | null;
  year: number | null;
  aired?: {
    from: string;
    to: string;
    string: string;
  };
  episodes: number;
  status: string;
  genres: { name: string }[];
  rating: string;
  type?: string;
  duration?: string;
  rank?: number;
}

export interface GeminiRecommendation {
  title: string;
  reason: string;
}

// Manga support
export interface Manga {
  id?: number | string;
  mal_id: number | string;
  title: string;
  title_english?: string;
  title_romaji?: string;
  title_native?: string;
  images: {
    jpg: {
      image_url: string;
      large_image_url: string;
    };
  };
  synopsis?: string;
  score?: number | null;
  rank?: number;
  status?: string;
  type?: string;
  chapters?: number | null;
  volumes?: number | null;
  genres?: { mal_id: number; name: string }[];
  authors?: { mal_id: number; name: string }[];
  published?: {
    from?: string;
    to?: string;
    string?: string;
  };
  countryOfOrigin?: string;
  synonyms?: string[];
  scraper_id?: string;
  latestChapter?: string;
  source?: string;
}

export interface MangaChapter {
  id: string;
  title: string;
  url: string;
  uploadDate?: string;
}

export interface MangaPage {
  pageNumber: number;
  imageUrl: string;
}
