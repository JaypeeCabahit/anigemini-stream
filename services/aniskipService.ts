// Minimal AniSkip client for OP/ED skip times
// Docs: https://github.com/aniskip/aniskip-api

const API = 'https://api.aniskip.com/v2/skip-times';

export interface SkipSegment {
  startTime: number;
  endTime: number;
  skipType: string; // op, ed, mixed, recap, etc.
  episodeLength?: number;
}

export interface SkipResult {
  found: boolean;
  segments: SkipSegment[];
}

export const getIntroSkip = async (malId: string | number, episodeNumber: number): Promise<SkipResult> => {
  try {
    const url = `${API}/${encodeURIComponent(String(malId))}/${episodeNumber}`;
    const res = await fetch(url);
    if (!res.ok) return { found: false, segments: [] };
    const json = await res.json();
    const results = json?.results ?? [];
    const segments: SkipSegment[] = results
      .filter((r: any) => r.skipType === 'op' || r.skipType === 'mixed') // prefer OP/mixed
      .map((r: any) => ({
        startTime: r.interval?.startTime ?? 0,
        endTime: r.interval?.endTime ?? 0,
        skipType: r.skipType,
        episodeLength: r.episodeLength,
      }))
      .filter(seg => seg.endTime > seg.startTime);
    return { found: segments.length > 0, segments };
  } catch (err) {
    console.warn('AniSkip error', err);
    return { found: false, segments: [] };
  }
};
