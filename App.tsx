import React, { useState, useEffect, useRef, useCallback } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import { HashRouter, Routes, Route, Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Search, Home, PlayCircle, Play, Pause, User, LogOut, Menu, X, Heart, Star, Plus, Info, Sparkles, LogIn, Lock, AlertCircle, ChevronRight, ChevronLeft, Calendar, Clock, Monitor, Mic, SkipForward, SkipBack, Lightbulb, Tv, Settings, MessageCircle, ChevronsRight, ChevronsLeft, Shuffle, Users, Edit3, Check, Globe, BookOpen } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import * as jikanService from './services/jikanService';
import * as geminiService from './services/geminiService';
import * as streamingService from './services/streamingService';
import * as mangaService from './services/mangaService';
import { Anime, GeminiRecommendation, Manga, MangaChapter } from './types';
import { AnimeCardSkeleton, HeroSkeleton, DetailsSkeleton, EpisodeListSkeleton } from './components/LoadingSkeleton';
import { LazyImage } from './components/LazyImage';
import { ErrorBoundary } from './components/ErrorBoundary';

// --- MyAnimeList OAuth (PKCE) helpers ---
const MAL_CLIENT_ID = import.meta.env.VITE_MAL_CLIENT_ID || '';
const MAL_REDIRECT_URI = import.meta.env.VITE_MAL_REDIRECT_URI || window.location.origin;
const MAL_ACCESS_KEY = 'malAccessToken';
const MAL_REFRESH_KEY = 'malRefreshToken';
const MAL_EXPIRES_KEY = 'malTokenExpiresAt';
const MAL_PROFILE_KEY = 'malProfileName';
const MAL_STATE_KEY = 'malOauthState';
const MAL_VERIFIER_KEY = 'malCodeVerifier';
const MAL_AUTH_ERROR_KEY = 'malAuthError';

const malBase64Url = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const malRandomString = (length = 64) => malBase64Url(crypto.getRandomValues(new Uint8Array(length))).slice(0, length);

const malPkceChallenge = async (verifier: string) => {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return malBase64Url(hash);
};

const saveMALTokens = (resp: { access_token: string; refresh_token?: string; expires_in: number }) => {
  const expiresAt = Date.now() + Math.max(0, resp.expires_in - 60) * 1000; // refresh 1 min early
  localStorage.setItem(MAL_ACCESS_KEY, resp.access_token);
  if (resp.refresh_token) localStorage.setItem(MAL_REFRESH_KEY, resp.refresh_token);
  localStorage.setItem(MAL_EXPIRES_KEY, String(expiresAt));
  window.dispatchEvent(new Event('mal-auth-changed'));
};

const clearMALTokens = () => {
  [MAL_ACCESS_KEY, MAL_REFRESH_KEY, MAL_EXPIRES_KEY, MAL_PROFILE_KEY].forEach(k => localStorage.removeItem(k));
  window.dispatchEvent(new Event('mal-auth-changed'));
};

const getStoredMALToken = () => {
  const token = localStorage.getItem(MAL_ACCESS_KEY);
  const expires = Number(localStorage.getItem(MAL_EXPIRES_KEY));
  if (token && expires && Date.now() < expires) return token;
  return null;
};

const beginMALAuth = async () => {
  if (!MAL_CLIENT_ID) throw new Error('Missing MAL client id (VITE_MAL_CLIENT_ID).');
  const verifier = malRandomString(64);
  const state = `mal-${malRandomString(16)}`;
  const challenge = await malPkceChallenge(verifier);
  localStorage.setItem(MAL_VERIFIER_KEY, verifier);
  localStorage.setItem(MAL_STATE_KEY, state);
  const authUrl = `https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(MAL_CLIENT_ID)}&code_challenge=${challenge}&state=${state}&redirect_uri=${encodeURIComponent(MAL_REDIRECT_URI)}`;
  window.location.href = authUrl;
};

const exchangeMALCode = async (code: string, verifier: string) => {
  const params = new URLSearchParams({
    client_id: MAL_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: MAL_REDIRECT_URI,
  });
  const res = await fetch('https://myanimelist.net/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error('MAL token exchange failed.');
  const data = await res.json();
  saveMALTokens(data);
  return data as { access_token: string; refresh_token?: string; expires_in: number };
};

const refreshMALToken = async () => {
  const refreshToken = localStorage.getItem(MAL_REFRESH_KEY);
  if (!refreshToken || !MAL_CLIENT_ID) return null;
  const params = new URLSearchParams({
    client_id: MAL_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    redirect_uri: MAL_REDIRECT_URI,
  });
  const res = await fetch('https://myanimelist.net/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    clearMALTokens();
    return null;
  }
  const data = await res.json();
  saveMALTokens(data);
  return data.access_token as string;
};

const fetchMALProfile = async (accessToken: string) => {
  const res = await fetch('https://api.myanimelist.net/v2/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data?.name) {
    localStorage.setItem(MAL_PROFILE_KEY, data.name);
    window.dispatchEvent(new Event('mal-auth-changed'));
  }
  return data;
};

// --- Types ---
type ThemeMode = 'light' | 'dark';

// --- Shared Components ---

const Badge = ({ children, color = 'bg-brand-500' }: { children: React.ReactNode, color?: string }) => (
  <span className={`${color} text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm`}>
    {children}
  </span>
);

// Utility component to scroll to top on route change
const ScrollToTop = () => {
  const { pathname, search } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname, search]);

  return null;
};

// Handles MAL OAuth callback (code/state) globally once the app loads
const MALCallbackHandler = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    const expectedState = localStorage.getItem(MAL_STATE_KEY);
    const verifier = localStorage.getItem(MAL_VERIFIER_KEY);

    if (!code) return;

    // Only handle if we were expecting a MAL callback
    if (!expectedState || state !== expectedState || !verifier) {
      localStorage.setItem(MAL_AUTH_ERROR_KEY, 'Invalid MAL callback. Please try connecting again.');
      window.dispatchEvent(new Event('mal-auth-changed'));
      navigate('/profile', { replace: true });
      return;
    }

    (async () => {
      try {
        const tokenData = await exchangeMALCode(code, verifier);
        await fetchMALProfile(tokenData.access_token);
      } catch (err: any) {
        localStorage.setItem(MAL_AUTH_ERROR_KEY, err?.message || 'Failed to connect to MyAnimeList.');
        clearMALTokens();
      } finally {
        localStorage.removeItem(MAL_STATE_KEY);
        localStorage.removeItem(MAL_VERIFIER_KEY);
        window.dispatchEvent(new Event('mal-auth-changed'));
        // Strip query params and go to profile import tab
        navigate('/profile', { replace: true });
      }
    })();
  }, [location.search, location.pathname, navigate]);

  return null;
};

// --- Pagination Component ---
interface PaginationProps {
  currentPage: number;
  lastPage: number;
  onPageChange: (page: number) => void;
}

const Pagination = ({ currentPage, lastPage, onPageChange }: PaginationProps) => {
  if (lastPage <= 1) return null;

  // Logic to show limited page numbers (e.g. 1 2 3 ... 10)
  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 3; // Number of pages to show before/after current

    if (lastPage <= 5) {
      for (let i = 1; i <= lastPage; i++) pages.push(i);
    } else {
      // Always show 1
      pages.push(1);

      let start = Math.max(2, currentPage - 1);
      let end = Math.min(lastPage - 1, currentPage + 1);

      if (currentPage <= 3) {
        end = 4;
      }
      if (currentPage >= lastPage - 2) {
        start = lastPage - 3;
      }

      if (start > 2) pages.push('...');

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (end < lastPage - 1) pages.push('...');

      // Always show last
      pages.push(lastPage);
    }
    return pages;
  };

  return (
    <div className="flex justify-center items-center gap-2 mt-12 mb-6">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-[#2a2c31] text-gray-400 hover:bg-[#3a3c42] hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      {getPageNumbers().map((page, idx) => (
        <button
          key={idx}
          onClick={() => typeof page === 'number' ? onPageChange(page) : null}
          disabled={typeof page !== 'number'}
          className={`w-10 h-10 flex items-center justify-center rounded-full text-sm font-bold transition
            ${page === currentPage
              ? 'bg-brand-400 text-black shadow-[0_0_15px_rgba(255,107,129,0.4)]'
              : typeof page === 'number'
                ? 'bg-[#2a2c31] text-gray-400 hover:bg-[#3a3c42] hover:text-white'
                : 'text-gray-500 cursor-default'
            }`}
        >
          {page}
        </button>
      ))}

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === lastPage}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-[#2a2c31] text-gray-400 hover:bg-[#3a3c42] hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
};

// --- Sidebar Component ---
const Sidebar = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const navigate = useNavigate();

  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
  };

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/70 z-[60] backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Sidebar Drawer */}
      <div className={`fixed top-0 left-0 h-full w-[280px] bg-[#202125] z-[70] transform transition-transform duration-300 ease-in-out border-r border-white/5 overflow-y-auto custom-scrollbar ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 flex flex-col h-full">
          <button onClick={onClose} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 font-medium text-sm">
            <div className="bg-white/10 p-1 rounded-full"><ChevronRight className="w-4 h-4 rotate-180" /></div> Close menu
          </button>

          <div className="space-y-1 mb-6">
            <SidebarLink label="Home" onClick={() => handleNavigate('/home')} active />
            <SidebarLink label="Community" onClick={() => handleNavigate('/community')} />
            <SidebarLink label="About" onClick={() => handleNavigate('/about')} />
            <SidebarLink label="Random Anime" onClick={() => { onClose(); jikanService.getRandomAnime().then(id => { if (id) navigate(`/anime/${id}`); }); }} />
            <div className="h-px bg-white/5 my-2" />
            <SidebarLink label="Subbed Anime" onClick={() => handleNavigate('/search?q=subbed')} />
            <SidebarLink label="Dubbed Anime" onClick={() => handleNavigate('/search?q=dubbed')} />
            <SidebarLink label="Most Popular" onClick={() => handleNavigate('/search?filter=popular')} />
            <SidebarLink label="Movies" onClick={() => handleNavigate('/search?q=movie')} />
            <SidebarLink label="TV Series" onClick={() => handleNavigate('/search?q=tv')} />
            <SidebarLink label="OVAs" onClick={() => handleNavigate('/search?q=ova')} />
            <SidebarLink label="ONAs" onClick={() => handleNavigate('/search?q=ona')} />
            <SidebarLink label="Specials" onClick={() => handleNavigate('/search?q=special')} />
          </div>

          <div className="pt-6 border-t border-white/5">
            <h3 className="text-gray-500 font-bold text-sm mb-4 px-2 uppercase tracking-wider">Genre</h3>
            <div className="grid grid-cols-2 gap-1">
              {['Action', 'Adventure', 'Cars', 'Comedy', 'Dementia', 'Demons', 'Drama', 'Ecchi', 'Fantasy', 'Game', 'Harem', 'Historical', 'Horror', 'Isekai', 'Josei', 'Kids', 'Magic', 'Martial Arts', 'Mecha', 'Military', 'Music', 'Mystery', 'Parody', 'Police', 'Psychological', 'Romance', 'Samurai', 'School', 'Sci-Fi', 'Seinen', 'Shoujo', 'Shounen', 'Slice of Life', 'Space', 'Sports', 'Super Power', 'Supernatural', 'Thriller', 'Vampire'].map(genre => (
                <button key={genre} onClick={() => handleNavigate(`/search?q=${genre}`)} className="text-left text-xs text-gray-400 hover:text-brand-500 px-2 py-1.5 transition truncate">
                  {genre}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const SidebarLink = ({ label, onClick, active }: { label: string; onClick: () => void; active?: boolean }) => (
  <button onClick={onClick} className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition block ${active ? 'bg-white/5 text-white border-l-4 border-brand-500' : 'text-gray-300 hover:text-white hover:bg-white/5 border-l-4 border-transparent'}`}>
    {label}
  </button>
);

// Title language context — persists in localStorage
type TitleLang = 'english' | 'romaji';
const TitleLangContext = React.createContext<{ lang: TitleLang; setLang: (l: TitleLang) => void }>({
  lang: 'english', setLang: () => { },
});
export const useTitleLang = () => React.useContext(TitleLangContext);
export const getDisplayTitle = (anime: Anime, lang: TitleLang): string => {
  const t = (anime as any)._titles;
  if (!t) return anime.title;
  if (lang === 'romaji') return t.romaji || t.english || anime.title;
  return t.english || t.romaji || anime.title;
};

// ─── App-wide Settings (localStorage) ───────────────────────────────────────
interface AppSettings {
  autoPlay: boolean;
  autoNext: boolean;
  skipSeconds: number;
  autoSkipIntro: boolean;
}
const DEFAULT_SETTINGS: AppSettings = { autoPlay: true, autoNext: true, skipSeconds: 10, autoSkipIntro: false };
const getSettings = (): AppSettings => {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('aniweb-settings') || '{}') }; }
  catch { return DEFAULT_SETTINGS; }
};
const saveSettings = (s: AppSettings) => localStorage.setItem('aniweb-settings', JSON.stringify(s));
const useSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(getSettings);
  const updateSetting = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => {
    setSettings(prev => { const next = { ...prev, [key]: val }; saveSettings(next); return next; });
  };
  return { settings, updateSetting };
};

const NavBar = () => {
  const { user, login, logout, isAuthenticated, userProfile } = useAuth();
  const { lang, setLang } = useTitleLang();
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isMangaMode = location.pathname.startsWith('/manga');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Anime[]>([]);
  const [mangaSuggestions, setMangaSuggestions] = useState<Manga[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingRandom, setIsLoadingRandom] = useState(false);
  const searchTimeout = useRef<any>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setShowSuggestions(false);
      if (isMangaMode) navigate(`/manga/search?q=${encodeURIComponent(searchQuery.trim())}`);
      else navigate(`/search?q=${searchQuery}`);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (value.length > 2) {
      searchTimeout.current = setTimeout(async () => {
        try {
          if (isMangaMode) {
            const results = await mangaService.searchManga(value, 1, 5);
            setMangaSuggestions(results.data.slice(0, 5));
            setSuggestions([]);
          } else {
            const results = await jikanService.searchAnime(value);
            setSuggestions(results.data.slice(0, 5));
            setMangaSuggestions([]);
          }
          setShowSuggestions(true);
        } catch { setSuggestions([]); setMangaSuggestions([]); }
      }, 500);
    } else {
      setSuggestions([]);
      setMangaSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (id: string) => {
    setShowSuggestions(false);
    setSearchQuery('');
    if (isMangaMode) navigate(`/manga/${id}`);
    else navigate(`/anime/${id}`);
  };

  const handleRandom = async () => {
    if (isLoadingRandom) return;
    setIsLoadingRandom(true);
    try {
      const id = await jikanService.getRandomAnime();
      if (id) navigate(`/anime/${id}`);
    } finally {
      setIsLoadingRandom(false);
    }
  };

  const cycleLang = () => {
    setLang(lang === 'english' ? 'romaji' : 'english');
  };

  const langLabel: Record<TitleLang, string> = { english: 'EN', romaji: 'JP' };

  return (
    <>
      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

      <nav className={`sticky top-0 z-50 bg-[#202125]/95 backdrop-blur-md border-b shadow-lg transition-colors ${isMangaMode ? 'border-purple-500/20' : 'border-white/5'}`}>
        <div className="w-full max-w-[2500px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Left: Burger + Logo + ANI/MAN toggle */}
            <div className="flex items-center gap-3 md:gap-4 shrink-0">
              <button onClick={() => setSidebarOpen(true)} className="text-gray-300 hover:text-white transition p-1">
                <Menu className="w-7 h-7" />
              </button>
              <Link to="/home" className="flex flex-col group">
                <div className="flex items-baseline gap-1">
                  <span className={`text-xl md:text-2xl font-black text-white tracking-tight leading-none transition ${isMangaMode ? 'group-hover:text-purple-400' : 'group-hover:text-brand-500'}`}>AniWeb</span>
                  <span className={`text-[10px] md:text-xs font-bold uppercase tracking-widest leading-none ${isMangaMode ? 'text-purple-400' : 'text-brand-500'}`}>Stream</span>
                </div>
              </Link>
              {/* ANI / MAN toggle */}
              <div className={`flex items-center rounded-lg bg-[#151619] overflow-hidden border transition-colors ${isMangaMode ? 'border-purple-500/30 hover:border-purple-500/50' : 'border-white/5 hover:border-white/10'}`}>
                <Link to="/home"
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all duration-200 ${!isMangaMode ? 'bg-brand-500 text-white' : 'text-gray-500 hover:text-white'}`}>
                  ANI
                </Link>
                <Link to="/manga"
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all duration-200 ${isMangaMode ? 'bg-purple-600 text-white' : 'text-gray-500 hover:text-white'}`}>
                  MAN
                </Link>
              </div>
            </div>

            {/* Middle: Search */}
            <div className="hidden md:flex flex-1 justify-center px-8">
              <div className="w-full max-w-xl relative group">
                <form onSubmit={handleSearch}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={handleInputChange}
                    onFocus={() => { if (suggestions.length > 0 || mangaSuggestions.length > 0) setShowSuggestions(true); }}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    placeholder={isMangaMode ? 'Search manga...' : 'Search anime...'}
                    className={`w-full bg-[#151619] text-gray-200 pl-4 pr-11 py-2.5 rounded-none rounded-l-lg focus:outline-none focus:ring-0 border transition-all group-hover:bg-[#1a1b1e] ${isMangaMode ? 'border-purple-500/20 focus:border-purple-500/40' : 'border-white/5'}`}
                  />
                  <button type="submit" className={`absolute right-0 top-0 bottom-0 px-4 transition text-white rounded-r-lg flex items-center justify-center ${isMangaMode ? 'bg-purple-600 hover:bg-purple-500' : 'bg-brand-600 hover:bg-brand-500'}`}>
                    <Search className="w-4 h-4" />
                  </button>
                </form>
                {showSuggestions && (suggestions.length > 0 || mangaSuggestions.length > 0) && (
                  <div className={`absolute top-full left-0 right-0 bg-[#2a2c31] border rounded-b-lg shadow-2xl mt-1 overflow-hidden z-[100] ${isMangaMode ? 'border-purple-500/20' : 'border-white/10'}`}>
                    {isMangaMode
                      ? mangaSuggestions.map(m => (
                        <div key={String(m.mal_id)} onClick={() => handleSuggestionClick(String(m.mal_id))}
                          className="flex items-center gap-3 p-3 hover:bg-white/10 cursor-pointer transition border-b border-white/5 last:border-0">
                          <img src={m.images.jpg.image_url} alt="" className="w-10 h-14 object-cover rounded bg-gray-800" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-bold text-white truncate">{m.title_english || m.title}</span>
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <span className="text-purple-400">{m.type || 'Manga'}</span>
                              {m.status && <><span className="w-1 h-1 rounded-full bg-gray-500" /><span>{m.status}</span></>}
                            </div>
                          </div>
                        </div>
                      ))
                      : suggestions.map(anime => (
                        <div key={anime.mal_id} onClick={() => handleSuggestionClick(anime.mal_id)}
                          className="flex items-center gap-3 p-3 hover:bg-white/10 cursor-pointer transition border-b border-white/5 last:border-0">
                          <img src={anime.images.webp.image_url} alt="" className="w-10 h-14 object-cover rounded bg-gray-800" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-bold text-white truncate">{getDisplayTitle(anime, lang)}</span>
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <span>{anime.year || (anime.aired?.from ? new Date(anime.aired.from).getFullYear() : '')}</span>
                              <span className="w-1 h-1 rounded-full bg-gray-500" />
                              <span>{anime.type}</span>
                            </div>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            </div>

            {/* Right: Controls + Profile */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Community link */}
              <Link to="/community" title="Community"
                className={`hidden md:flex items-center justify-center w-9 h-9 rounded-lg transition border border-white/5 ${location.pathname === '/community' ? (isMangaMode ? 'bg-purple-600 text-white' : 'bg-brand-500 text-white') : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white'}`}>
                <Users className="w-4 h-4" />
              </Link>

              {/* Title language toggle */}
              <button onClick={cycleLang} title="Toggle title language"
                className="hidden md:flex items-center justify-center w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-[11px] font-black tracking-wide transition border border-white/5">
                {langLabel[lang]}
              </button>

              {/* Random anime button */}
              <button onClick={handleRandom} disabled={isLoadingRandom} title="Random Anime"
                className="hidden md:flex items-center justify-center w-9 h-9 rounded-lg bg-white/5 hover:bg-brand-500 text-gray-400 hover:text-white transition border border-white/5 disabled:opacity-50">
                <Shuffle className={`w-4 h-4 transition-transform ${isLoadingRandom ? 'animate-spin' : 'hover:rotate-180'}`} />
              </button>



              {/* Profile / Login */}
              {isAuthenticated ? (
                <Link to="/profile" className="flex items-center gap-3 hover:bg-white/5 p-1.5 rounded-full transition">
                  <img src={userProfile.customPhotoURL || user?.photoURL || ''} alt="avatar"
                    className="w-10 h-10 rounded-full border-2 border-brand-500 object-cover shadow-lg" />
                  <div className="hidden lg:flex flex-col items-start mr-1">
                    <span className="text-sm font-bold text-white leading-none">{user?.displayName}</span>
                    {userProfile.customTag
                      ? <span className="text-[11px] text-brand-400 leading-none mt-1">{userProfile.customTag}</span>
                      : <span className="text-[11px] text-gray-500 leading-none mt-1">Member</span>}
                  </div>
                </Link>
              ) : (
                <button onClick={() => login()}
                  className="bg-brand-600 hover:bg-brand-500 text-white px-5 py-2 rounded-full font-bold transition text-xs uppercase tracking-wide shadow-lg shadow-brand-500/20 flex items-center gap-2">
                  <LogIn className="w-3 h-3" />
                  <span className="hidden md:inline">Login</span>
                </button>
              )}
            </div>

          </div>
        </div>
      </nav>
    </>
  );
};

// ─── Watchlist Status Modal ───────────────────────────────────────────────────
const WATCH_STATUSES = ['Watching', 'Completed', 'On-Hold', 'Plan to Watch', 'Dropped'] as const;
type WatchStatus = typeof WATCH_STATUSES[number];

const STATUS_META: Record<WatchStatus, { color: string; icon: string }> = {
  'Watching': { color: 'bg-brand-500', icon: '▶' },
  'Completed': { color: 'bg-green-600', icon: '✓' },
  'On-Hold': { color: 'bg-yellow-500', icon: '⏸' },
  'Plan to Watch': { color: 'bg-blue-600', icon: '📋' },
  'Dropped': { color: 'bg-red-700', icon: '✕' },
};

interface WatchlistModalProps {
  anime: Anime;
  currentStatus?: string;
  onClose: () => void;
  onSelect: (status: WatchStatus) => void;
}
const WatchlistModal = ({ anime, currentStatus, onClose, onSelect }: WatchlistModalProps) => {
  const { lang } = useTitleLang();
  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-[#1a1b1f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-white/5">
          <img src={anime.images.jpg.image_url} alt="" className="w-10 h-14 rounded-lg object-cover flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500 mb-0.5">Add to your list</p>
            <h3 className="text-sm font-bold text-white line-clamp-2 leading-snug">{getDisplayTitle(anime, lang)}</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        {/* Status options */}
        <div className="p-3 space-y-1.5">
          {WATCH_STATUSES.map(status => {
            const meta = STATUS_META[status];
            const isActive = currentStatus === status;
            return (
              <button key={status} onClick={() => onSelect(status)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition
                  ${isActive ? `${meta.color} text-white shadow-lg` : 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white'}`}>
                <span className="text-base w-5 text-center">{meta.icon}</span>
                {status}
                {isActive && <span className="ml-auto text-xs opacity-70">Current</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const AnimeCard = ({ anime, rank }: { anime: Anime; rank?: number }) => {
  const year = anime.year || (anime.aired?.from ? new Date(anime.aired.from).getFullYear() : null);
  const { lang } = useTitleLang();
  const title = getDisplayTitle(anime, lang);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<'right' | 'left'>('right');
  const cardRef = useRef<HTMLDivElement>(null);
  const tooltipTimer = useRef<any>(null);

  const handleMouseEnter = () => {
    tooltipTimer.current = setTimeout(() => {
      if (cardRef.current) {
        const rect = cardRef.current.getBoundingClientRect();
        setTooltipPos(rect.left > window.innerWidth / 2 ? 'left' : 'right');
      }
      setShowTooltip(true);
    }, 400);
  };
  const handleMouseLeave = () => {
    clearTimeout(tooltipTimer.current);
    setShowTooltip(false);
  };

  return (
    <div ref={cardRef} className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <Link to={`/anime/${anime.mal_id}`} className="group relative block w-full">
        <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-[#2a2c31]">
          {rank && (
            <div className={`absolute top-0 left-0 w-8 h-8 md:w-10 md:h-10 z-10 flex items-center justify-center font-black text-lg md:text-xl text-white rounded-br-xl ${rank <= 3 ? 'bg-brand-500' : 'bg-gray-700'}`}>
              {rank}
            </div>
          )}
          <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 items-end">
            <Badge color="bg-white/90 text-black">HD</Badge>
            {anime.episodes && <Badge color="bg-brand-600">EP {anime.episodes}</Badge>}
          </div>
          <LazyImage
            src={anime.images.webp.large_image_url}
            alt={anime.title}
            className="w-full h-full object-cover object-top transition duration-500 group-hover:scale-105 group-hover:opacity-80"
          />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-300 z-20 backdrop-blur-[2px] bg-black/20">
            <div className="bg-brand-500 rounded-full w-14 h-14 flex items-center justify-center shadow-xl transform scale-50 group-hover:scale-100 transition hover:bg-brand-600">
              <Play className="w-6 h-6 text-white fill-current ml-1" />
            </div>
          </div>
        </div>
        <div className="mt-2.5">
          <h3 className="text-white font-semibold text-sm line-clamp-1 group-hover:text-brand-500 transition">{title}</h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <span>{anime.type || 'TV'}</span>
            {year && <><span className="w-1 h-1 rounded-full bg-gray-600" /><span>{year}</span></>}
          </div>
        </div>
      </Link>

      {/* Hover Tooltip */}
      {showTooltip && (
        <div className={`absolute top-0 z-[200] w-64 bg-[#1a1b1f] border border-white/10 rounded-xl shadow-2xl shadow-black/60 p-4 pointer-events-none hidden md:block
          ${tooltipPos === 'right' ? 'left-full ml-3' : 'right-full mr-3'}`}
          style={{ animation: 'fadeInTooltip 0.15s ease-out' }}>
          <h4 className="text-sm font-black text-brand-400 mb-2 line-clamp-2 leading-snug">{title}</h4>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {anime.genres.slice(0, 3).map(g => (
              <span key={g.name} className="text-[10px] bg-white/5 border border-white/10 text-gray-300 px-2 py-0.5 rounded-full">{g.name}</span>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-y-1.5 text-xs mb-3">
            <div className="text-gray-500">Score</div>
            <div className="text-yellow-400 font-bold flex items-center gap-1">
              <Star className="w-3 h-3 fill-current" /> {anime.score ?? 'N/A'}
            </div>
            <div className="text-gray-500">Status</div>
            <div className="text-white truncate">{anime.status || '—'}</div>
            <div className="text-gray-500">Aired</div>
            <div className="text-white">{year || '—'}</div>
            {anime.episodes > 0 && <>
              <div className="text-gray-500">Episodes</div>
              <div className="text-white">{anime.episodes}</div>
            </>}
          </div>
          {anime.synopsis && (
            <p className="text-gray-400 text-[11px] leading-relaxed line-clamp-3">{anime.synopsis}</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] bg-brand-500/20 text-brand-400 border border-brand-500/30 px-2 py-0.5 rounded-full font-bold">{anime.type || 'TV'}</span>
            <span className="text-[10px] bg-white/5 text-gray-400 px-2 py-0.5 rounded-full">HD</span>
          </div>
        </div>
      )}
    </div>
  );
};

const SidebarCard = ({ anime, index }: { anime: Anime; index: number }) => {
  const { lang } = useTitleLang();
  return (
    <Link to={`/anime/${anime.mal_id}`} className="flex gap-4 items-center group p-2 rounded-lg hover:bg-white/5 transition border-b border-white/5 last:border-0">
      <div className={`flex-shrink-0 w-8 text-center font-black text-2xl ${index < 3 ? 'text-brand-500' : 'text-gray-600'}`}>
        {index + 1}
      </div>
      <div className="w-12 h-16 flex-shrink-0 rounded overflow-hidden bg-gray-800">
        <img src={anime.images.jpg.image_url} alt="" className="w-full h-full object-cover object-top" />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-white truncate group-hover:text-brand-500 transition">{getDisplayTitle(anime, lang)}</h4>
        <div className="flex items-center gap-2 mt-1">
          <Badge color="bg-brand-900/50 text-brand-300 border border-brand-500/20">{anime.type || 'TV'}</Badge>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Star className="w-3 h-3 text-yellow-500 fill-current" /> {anime.score}
          </div>
        </div>
      </div>
    </Link>
  );
};

const Hero = ({ animeList }: { animeList: Anime[] }) => {
  const { lang } = useTitleLang();
  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: true, duration: 20 },
    [Autoplay({ delay: 6000, stopOnInteraction: false, stopOnMouseEnter: false })]
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
    return () => { emblaApi.off('select', onSelect); };
  }, [emblaApi, onSelect]);

  const handleNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const handlePrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi]);

  if (!animeList || animeList.length === 0) return null;

  return (
    <div className="relative h-[60vh] md:h-[70vh] w-full overflow-hidden bg-[#151619]">
      {/* Embla viewport */}
      <div className="absolute inset-0 overflow-hidden" ref={emblaRef}>
        <div className="flex h-full touch-pan-y select-none">
          {animeList.map((anime, index) => {
            const year = anime.year || (anime.aired?.from ? new Date(anime.aired.from).getFullYear() : null);
            // Use banner (landscape) for bg, cover for poster
            const bannerImage = anime.trailer.images.maximum_image_url || anime.trailer.images.large_image_url;
            const coverImage = anime.images.webp.large_image_url;
            const directDistance = Math.abs(index - selectedIndex);
            const loopDistance = Math.min(directDistance, animeList.length - directDistance);
            const shouldLoad = loopDistance <= 1;

            return (
              <div key={anime.mal_id} className="relative min-w-full h-full flex-[0_0_100%]">
                {/* Background layer */}
                <div className="absolute inset-0 z-0">
                  {/* Wide banner image on the right side with mask fade */}
                  {shouldLoad && bannerImage && (
                    <div
                      className="absolute right-0 top-0 w-full md:w-[70%] h-full bg-no-repeat bg-cover bg-center"
                      style={{
                        backgroundImage: `url(${bannerImage})`,
                        maskImage: 'linear-gradient(90deg, transparent 0%, black 25%, black 100%)',
                        WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 25%, black 100%)',
                      }}
                    />
                  )}
                  {/* Gradient overlays */}
                  <div className="absolute inset-0 bg-gradient-to-r from-[#202125] via-[#202125]/80 to-transparent pointer-events-none" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#202125] via-transparent to-[#202125]/30 pointer-events-none" />
                </div>

                {/* Content */}
                <div className="absolute inset-0 flex items-center z-10">
                  <div className="w-full max-w-[2500px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center gap-6 max-w-3xl">
                      {/* Cover poster — visible on md+ */}
                      <div className="hidden md:block flex-shrink-0 w-36 lg:w-44 rounded-xl overflow-hidden shadow-2xl shadow-black/60 border border-white/10">
                        <img src={coverImage} alt={anime.title} className="w-full h-auto object-cover" />
                      </div>

                      {/* Text info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-brand-400 font-bold text-xs md:text-sm tracking-widest uppercase mb-3">
                          #{index + 1} Spotlight
                        </div>
                        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-3 leading-tight line-clamp-2">
                          {getDisplayTitle(anime, lang)}
                        </h1>

                        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs md:text-sm">
                          <div className="flex items-center gap-3 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/5 text-white">
                            <span className="flex items-center gap-1"><Play className="w-3 h-3 text-brand-400 fill-current" /> {anime.type || 'TV'}</span>
                            <span className="w-px h-3 bg-white/20" />
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-gray-400" /> {anime.duration || '24 min'}</span>
                            {year && <><span className="w-px h-3 bg-white/20" /><span className="flex items-center gap-1"><Calendar className="w-3 h-3 text-gray-400" /> {year}</span></>}
                          </div>
                          <span className="bg-brand-500 text-white text-xs font-bold px-2.5 py-1 rounded">HD</span>
                          {anime.score && <span className="bg-yellow-400 text-black text-xs font-black px-2.5 py-1 rounded flex items-center gap-1"><Star className="w-3 h-3 fill-current" />{anime.score.toFixed(1)}</span>}
                        </div>

                        <p className="text-gray-300 text-sm md:text-base mb-6 line-clamp-2 md:line-clamp-3 leading-relaxed max-w-xl">
                          {anime.synopsis}
                        </p>

                        <div className="flex items-center gap-3">
                          <Link
                            to={`/anime/${anime.mal_id}/watch`}
                            className="bg-brand-500 text-white px-6 md:px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:bg-brand-600 transition shadow-lg shadow-brand-500/30 text-sm"
                          >
                            <Play className="w-4 h-4 fill-current" /> Watch Now
                          </Link>
                          <Link
                            to={`/anime/${anime.mal_id}`}
                            className="bg-white/10 backdrop-blur-md border border-white/20 text-white px-6 md:px-8 py-3 rounded-full font-bold hover:bg-white/20 transition flex items-center gap-2 text-sm"
                          >
                            Detail <ChevronRight className="w-4 h-4" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dot indicators */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex gap-2 items-center">
        {animeList.map((_, idx) => (
          <button
            key={idx}
            onClick={() => scrollTo(idx)}
            className={`rounded-full transition-all duration-300 ${idx === selectedIndex
              ? 'bg-brand-400 w-6 h-2'
              : 'bg-white/30 hover:bg-white/50 w-2 h-2'
              }`}
          />
        ))}
      </div>

      {/* Prev/Next buttons */}
      <div className="absolute bottom-4 right-6 z-20 hidden md:flex gap-2">
        <button onClick={handlePrev} className="p-2 bg-black/60 hover:bg-brand-500 text-white rounded-lg border border-white/10 transition backdrop-blur-md">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button onClick={handleNext} className="p-2 bg-black/60 hover:bg-brand-500 text-white rounded-lg border border-white/10 transition backdrop-blur-md">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

const VideoPlayer = ({ src, poster, headers, isEmbed = false, startAt = 0, onProgress, onEnded, skipSeconds = 10 }: {
  src: string;
  poster?: string;
  headers?: Record<string, string>;
  isEmbed?: boolean;
  startAt?: number;
  onProgress?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  skipSeconds?: number;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const hlsRef = useRef<any>(null);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); } else { v.pause(); }
  };

  // Keyboard shortcuts: Space=play/pause, J/←=rewind, L/→=forward
  useEffect(() => {
    if (isEmbed) return;
    const handleKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
      else if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - skipSeconds); }
      else if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min(v.duration || 0, v.currentTime + skipSeconds); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isEmbed, skipSeconds]);

  useEffect(() => {
    if (isEmbed) return;
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setIsReady(false);
    setError('');

    const handleCanPlay = () => setIsReady(true);
    const handleError = () => setError('Failed to load video. Please try another episode or server.');

    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);

    if (src.endsWith('.m3u8')) {
      if ((window as any).Hls && (window as any).Hls.isSupported()) {
        const hls = new (window as any).Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
          xhrSetup: (xhr: XMLHttpRequest) => {
            if (headers) {
              Object.entries(headers).forEach(([key, value]) => {
                xhr.setRequestHeader(key, value);
              });
            }
          }
        });

        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on((window as any).Hls.Events.ERROR, (_event: any, data: any) => {
          if (data.fatal) {
            setError('Stream error. Please try another server.');
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
      }
    } else {
      video.src = src;
    }

    return () => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src, headers, isEmbed]);

  if (isEmbed) {
    return (
      <div className="w-full h-full bg-black">
        <iframe
          key={src}
          src={src}
          className="w-full h-full border-0"
          allowFullScreen
          allow="autoplay; fullscreen"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
        />
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-black relative group">
      {/* Quick play/pause button for small screens when native controls hide it */}
      <button
        type="button"
        onClick={togglePlay}
        className="absolute bottom-3 left-3 z-20 bg-black/75 text-white rounded-full p-2 shadow-lg shadow-black/50 md:hidden"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>

      {!isReady && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand-500 mb-3"></div>
          <p className="text-gray-400 text-sm">Loading stream...</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black text-center px-4">
          <AlertCircle className="w-12 h-12 text-red-500 mb-3" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      <video
        ref={videoRef}
        controls
        className="w-full h-full object-contain"
        poster={poster}
        playsInline
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onCanPlay={() => {
          if (startAt > 0 && videoRef.current) {
            videoRef.current.currentTime = startAt;
          }
        }}
        onTimeUpdate={() => {
          const v = videoRef.current;
          if (v && onProgress && v.duration > 0) onProgress(v.currentTime, v.duration);
        }}
        onEnded={onEnded}
      />

      {/* Mobile helper controls (outside native UI) */}
      <div className="md:hidden absolute -bottom-10 left-3 flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          className="flex items-center gap-2 bg-black/80 text-white px-3 py-1.5 rounded-full text-sm shadow-lg shadow-black/40"
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>
      </div>
    </div>
  );
}

// --- Pages ---

// ─── Estimated Schedule ───────────────────────────────────────────────────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ScheduleSection = () => {
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState<jikanService.AiringScheduleItem[]>([]);
  const [activeDay, setActiveDay] = useState(new Date().getDay()); // 0=Sun
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollSchedule = (dir: 'left' | 'right') => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: dir === 'right' ? 320 : -320, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const now = Math.floor(Date.now() / 1000);
    jikanService.getAiringSchedule(now, now + 7 * 86400).then(data => {
      setSchedule(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Build week day map: day index → items airing that day
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);

  const byDay: Record<number, jikanService.AiringScheduleItem[]> = {};
  for (let d = 0; d < 7; d++) byDay[d] = [];

  schedule.forEach(item => {
    const dt = new Date(item.airingAt * 1000);
    const dow = dt.getDay();
    if (byDay[dow]) byDay[dow].push(item);
  });

  const todayIndex = new Date().getDay();
  const dayItems = byDay[activeDay] ?? [];

  return (
    <section className="mt-12">
      <h2 className="text-xl md:text-2xl font-bold text-brand-100 uppercase tracking-tight mb-5 flex items-center gap-2">
        <Calendar className="w-5 h-5 text-brand-500" /> Estimated Schedule
      </h2>

      {/* Day selector */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1 no-scrollbar">
        {DAYS.map((day, idx) => (
          <button key={day}
            onClick={() => setActiveDay(idx)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition ${activeDay === idx
              ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20'
              : idx === todayIndex
                ? 'bg-white/10 text-white border border-brand-500/40'
                : 'bg-[#2a2c31] text-gray-400 hover:text-white hover:bg-white/10'
              }`}
          >
            {day}{idx === todayIndex ? ' •' : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-32 bg-[#2a2c31] rounded-xl p-3 animate-pulse border border-white/5">
              <div className="aspect-[3/4] bg-white/5 rounded-lg mb-2" />
              <div className="h-3 bg-white/5 rounded w-3/4 mb-1" />
              <div className="h-2 bg-white/5 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : dayItems.length === 0 ? (
        <p className="text-gray-500 text-sm py-6 text-center bg-[#1a1b1f] rounded-xl border border-white/5">
          No scheduled episodes for {DAYS[activeDay]}.
        </p>
      ) : (
        <div className="relative">
          {/* Left arrow */}
          <button onClick={() => scrollSchedule('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 -ml-3 w-8 h-8 bg-[#2a2c31] hover:bg-brand-500 border border-white/10 rounded-full flex items-center justify-center text-white shadow-lg transition hidden md:flex">
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div ref={scrollRef} className="flex gap-3 overflow-x-auto pb-2 no-scrollbar scroll-smooth">
            {dayItems.slice(0, 30).map(item => {
              const timeStr = new Date(item.airingAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <button key={item.id}
                  onClick={() => navigate(`/anime/${item.media.mal_id}`)}
                  className="group flex-shrink-0 w-28 sm:w-32 bg-[#1e1f23] hover:bg-[#2a2c31] border border-white/5 hover:border-brand-500/30 rounded-xl p-2.5 text-left transition">
                  <div className="aspect-[3/4] rounded-lg overflow-hidden bg-gray-800 mb-2">
                    <img src={item.media.images.jpg.image_url} alt={item.media.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                  </div>
                  <p className="text-xs font-semibold text-white line-clamp-2 group-hover:text-brand-400 transition leading-snug mb-1">{item.media.title}</p>
                  <div className="flex items-center gap-1 text-[10px] text-gray-500">
                    <Clock className="w-3 h-3 text-brand-500" />
                    <span>{timeStr}</span>
                    <span className="ml-auto text-brand-400">EP {item.episode}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right arrow */}
          <button onClick={() => scrollSchedule('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 -mr-3 w-8 h-8 bg-[#2a2c31] hover:bg-brand-500 border border-white/10 rounded-full flex items-center justify-center text-white shadow-lg transition hidden md:flex">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </section>
  );
};

const SIDEBAR_TABS = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
] as const;
type SidebarTab = typeof SIDEBAR_TABS[number]['key'];

const HomePage = () => {
  const [topAnime, setTopAnime] = useState<Anime[]>([]);
  const [seasonalAnime, setSeasonalAnime] = useState<Anime[]>([]);
  const [popularAnime, setPopularAnime] = useState<Anime[]>([]);
  const [latestEpisodes, setLatestEpisodes] = useState<jikanService.AiringScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('weekly');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const [top, seasonal, popular, recentSchedule] = await Promise.all([
          jikanService.getTopAnime(),
          jikanService.getSeasonalAnime(),
          jikanService.getPopularAnime(),
          // Past 7 days of aired episodes
          jikanService.getAiringSchedule(now - 7 * 86400, now),
        ]);
        setTopAnime(top.data);
        setSeasonalAnime(seasonal.data);
        setPopularAnime(popular.data);
        // Sort newest first, deduplicate by anime id, limit to 20
        const sorted = recentSchedule.sort((a, b) => b.airingAt - a.airingAt);
        const seen = new Set<string>();
        const deduped = sorted
          .filter(item => item.media?.mal_id) // skip entries without MAL id (can't open details)
          .filter(item => {
            const key = String(item.media.mal_id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        setLatestEpisodes(deduped.slice(0, 20));
      } catch (err) {
        console.error('Failed to load home page data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-[#202125] pb-24 md:pb-20">
      <HeroSkeleton />
      <div className="w-full max-w-[2500px] mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        <div className="flex flex-col lg:flex-row gap-8">
          <div className="flex-1">
            <div className="h-8 bg-gray-700 rounded w-48 mb-6 animate-pulse" />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4 gap-y-8">
              {Array.from({ length: 16 }).map((_, i) => <AnimeCardSkeleton key={i} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Daily = trending, Weekly = popular this season, Monthly = top currently airing (deduplicated)
  const monthlyAiring = [...seasonalAnime, ...topAnime]
    .filter((a, i, arr) => arr.findIndex(x => x.mal_id === a.mal_id) === i)
    .filter(a => a.status?.includes('Airing'));

  const sidebarList =
    sidebarTab === 'daily' ? topAnime :
      sidebarTab === 'weekly' ? seasonalAnime :
        monthlyAiring.length > 0 ? monthlyAiring : seasonalAnime;

  // Just Completed = finished anime from top list
  const completedAnime = topAnime.filter(a =>
    a.status?.toLowerCase().includes('finished') || a.status?.toLowerCase().includes('completed')
  );

  return (
    <div className="min-h-screen bg-[#202125] pb-24 md:pb-20">
      <Hero animeList={topAnime.slice(0, 10)} />

      <div className="w-full max-w-[2500px] mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        <div className="flex flex-col lg:flex-row gap-8">

          {/* Main content */}
          <div className="flex-1 min-w-0">

            {/* Latest Release — newest aired episodes at the top */}
            {latestEpisodes.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-xl md:text-2xl font-bold text-brand-100 uppercase tracking-tight flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse inline-block" />
                    Latest Release
                  </h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4 gap-y-8">
                  {latestEpisodes.map(item => {
                    // Wrap in AnimeCard for tooltip + lang toggle support
                    const asAnime = item.media as Anime;
                    return <AnimeCard key={item.id} anime={asAnime} />;
                  })}
                </div>
              </section>
            )}

            {/* Trending Now */}
            <section className={latestEpisodes.length > 0 ? 'mt-14' : ''}>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl md:text-2xl font-bold text-brand-100 uppercase tracking-tight">Trending Now</h2>
                <Link to="/search?filter=trending" className="text-xs text-gray-400 hover:text-white flex items-center gap-1">View All <ChevronRight className="w-3 h-3" /></Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4 gap-y-8">
                {seasonalAnime.map(anime => <AnimeCard key={anime.mal_id} anime={anime} />)}
              </div>
            </section>

            {/* Popular */}
            {topAnime.length > 0 && (
              <section className="mt-14">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl md:text-2xl font-bold text-brand-100 uppercase tracking-tight">Popular</h2>
                  <Link to="/search?filter=popular" className="text-xs text-gray-400 hover:text-white flex items-center gap-1">View All <ChevronRight className="w-3 h-3" /></Link>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4 gap-y-8">
                  {popularAnime.slice(0, 12).map(anime => <AnimeCard key={anime.mal_id} anime={anime} />)}
                </div>
              </section>
            )}

            {/* Just Completed */}
            {completedAnime.length > 0 && (
              <section className="mt-14">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl md:text-2xl font-bold text-brand-100 uppercase tracking-tight">Just Completed</h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4 gap-y-8">
                  {completedAnime.slice(0, 12).map(anime => <AnimeCard key={anime.mal_id} anime={anime} />)}
                </div>
              </section>
            )}

            {/* Estimated Schedule — at the bottom */}
            <ScheduleSection />
          </div>

          {/* Sidebar */}
          <div className="hidden lg:block w-80 flex-shrink-0">
            <div className="bg-[#2a2c31] rounded-xl p-4 sticky top-24 border border-white/5">
              <div className="mb-4 border-b border-white/5 pb-3">
                <h3 className="text-base font-bold text-white mb-3">Top Airing</h3>
                <div className="flex items-center bg-[#151619] rounded-lg overflow-hidden border border-white/5 w-full">
                  {SIDEBAR_TABS.map(({ key, label }) => (
                    <button key={key}
                      onClick={() => setSidebarTab(key)}
                      className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${sidebarTab === key ? 'bg-brand-500 text-white' : 'text-gray-500 hover:text-white'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {sidebarList.slice(0, 10).map((anime, index) => (
                  <SidebarCard key={anime.mal_id} anime={anime} index={index} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AnimeDetailsPage = () => {
  const { id } = useParams<{ id: string }>();
  const { lang } = useTitleLang();
  const [anime, setAnime] = useState<Anime | null>(null);
  const [characters, setCharacters] = useState<jikanService.Character[]>([]);
  const [recommendations, setRecommendations] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(true);
  const { addToWatchlist, updateWatchStatus, watchlist, user, login } = useAuth();
  const watchlistEntry = id ? watchlist.find(a => a.mal_id === id) : undefined;
  const isInWatchlist = !!watchlistEntry;
  const currentStatus = (watchlistEntry as any)?._watchStatus as string | undefined;
  const [showWatchlistModal, setShowWatchlistModal] = useState(false);

  useEffect(() => {
    if (id) {
      setLoading(true);
      Promise.all([
        jikanService.getAnimeDetails(id),
        jikanService.getAnimeCharacters(id),
        jikanService.getAnimeRecommendations(id)
      ]).then(async ([animeData, charData, recData]) => {
        // If AniList reports "Not yet aired" but streaming episodes exist, fix the status
        if (animeData?.status === 'Not yet aired') {
          try {
            const fast = await jikanService.getAnimeFast(id);
            if (fast && fast.episodes.length > 0) {
              animeData = {
                ...animeData,
                status: 'Currently Airing',
                episodes: animeData.episodes || fast.episodes.length,
              };
            }
          } catch { /* ignore — keep original status */ }
        }
        setAnime(animeData);
        setCharacters(charData);
        setRecommendations(recData);
        setLoading(false);
      });
    }
  }, [id]);

  if (loading || !anime) return <DetailsSkeleton />;

  const year = anime.year || (anime.aired?.from ? new Date(anime.aired.from).getFullYear() : null);

  return (
    <div className="min-h-screen pb-24 md:pb-20 bg-[#202125]">
      <div className="h-[400px] w-full relative">
        <div className="absolute inset-0 bg-cover bg-top" style={{ backgroundImage: `url(${anime.trailer.images.maximum_image_url || anime.images.webp.large_image_url})` }}></div>
        <div className="absolute inset-0 bg-[#202125]/80 backdrop-blur-sm" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#202125] to-transparent" />
      </div>

      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 -mt-60 relative z-10">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="w-48 sm:w-56 md:w-72 flex-shrink-0 mx-auto md:mx-0">
            <div className="rounded-xl overflow-hidden shadow-2xl shadow-black/50 border border-white/10 relative group">
              <img src={anime.images.webp.large_image_url} alt={anime.title} className="w-full h-auto object-cover object-top" />
              <button
                onClick={() => user ? setShowWatchlistModal(true) : login()}
                className={`absolute bottom-0 left-0 right-0 py-3 font-bold flex items-center justify-center gap-2 transition text-white text-sm
                  ${isInWatchlist ? 'bg-green-700 hover:bg-green-600' : 'bg-brand-600 hover:bg-brand-500'}`}
              >
                {isInWatchlist ? <Heart className="fill-current w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {isInWatchlist ? (currentStatus || 'In Library') : 'Add to List'}
              </button>
            </div>
          </div>

          <div className="flex-1 text-center md:text-left pt-4 md:pt-16">
            <div className="mb-2 flex items-center justify-center md:justify-start gap-2 text-xs font-bold tracking-widest text-brand-400">
              <span className="uppercase">Home</span>
              <span className="text-gray-600">•</span>
              <span className="uppercase">{anime.type || 'Anime'}</span>
              <span className="text-gray-600">•</span>
              <span className="text-white truncate max-w-[200px]">{getDisplayTitle(anime, lang)}</span>
            </div>

            <h1 className="text-2xl md:text-5xl font-black text-white mb-6 leading-tight">{getDisplayTitle(anime, lang)}</h1>

            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mb-8">
              <span className="bg-white text-black text-xs font-black px-2 py-1 rounded">HD</span>
              <span className="bg-yellow-500 text-black text-xs font-black px-2 py-1 rounded flex items-center gap-1">
                <Star className="w-3 h-3 fill-current" /> {anime.score}
              </span>
              <span className="text-gray-300 text-sm border-l border-gray-600 pl-4">{anime.rating}</span>
              {year && <span className="text-gray-300 text-sm border-l border-gray-600 pl-4">{year}</span>}
              <span className="text-gray-300 text-sm border-l border-gray-600 pl-4">{anime.episodes} Episodes</span>
              <span className="text-gray-300 text-sm border-l border-gray-600 pl-4">{anime.status}</span>
            </div>

            <div className="flex flex-wrap gap-4 mb-8 justify-center md:justify-start">
              <Link to={`/anime/${anime.mal_id}/watch`} className="bg-brand-500 hover:bg-brand-600 text-white px-8 py-3 rounded-full font-bold flex items-center gap-2 shadow-lg shadow-brand-500/30 transition transform hover:scale-105">
                <Play className="w-5 h-5 fill-current ml-0.5" /> Watch Now
              </Link>
            </div>

            <p className="text-gray-400 leading-relaxed mb-6 max-w-4xl text-sm md:text-base">{anime.synopsis}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-400 mb-8 border-t border-white/5 pt-6 text-left">
              <div className="flex gap-2 justify-center md:justify-start"><span className="text-white font-bold w-24">Type:</span> {anime.type}</div>
              <div className="flex gap-2 justify-center md:justify-start"><span className="text-white font-bold w-24">Status:</span> {anime.status}</div>
              <div className="flex gap-2 justify-center md:justify-start"><span className="text-white font-bold w-24">Genre:</span> <span className="text-brand-400">{anime.genres.map(g => g.name).join(', ')}</span></div>
            </div>
          </div>
        </div>

        {characters.length > 0 && (
          <div className="mt-12">
            <h2 className="text-xl font-bold text-brand-100 mb-6 flex items-center gap-2">
              <User className="text-brand-500" /> Characters & Voice Actors
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {characters.map((char) => (
                <div key={char.character.mal_id} className="bg-[#2a2c31] rounded-lg p-3 flex justify-between items-center border border-white/5">
                  <div className="flex items-center gap-3">
                    <img src={char.character.images.jpg.image_url} alt={char.character.name} className="w-12 h-12 rounded-full object-cover object-top" />
                    <div>
                      <p className="text-sm font-bold text-white">{char.character.name}</p>
                      <p className="text-xs text-gray-400">{char.role}</p>
                    </div>
                  </div>
                  {char.voice_actors[0] && (
                    <div className="flex items-center gap-3 text-right">
                      <div>
                        <p className="text-sm font-bold text-white">{char.voice_actors[0].person.name}</p>
                        <p className="text-xs text-gray-400">{char.voice_actors[0].language}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {recommendations.length > 0 && (
          <div className="mt-16">
            <h2 className="text-xl font-bold text-brand-100 mb-6 flex items-center gap-2">
              <Tv className="text-brand-500" /> Recommended for you
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {recommendations.map(rec => (
                <AnimeCard key={rec.mal_id} anime={rec} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Watchlist Status Modal */}
      {showWatchlistModal && (
        <WatchlistModal
          anime={anime}
          currentStatus={currentStatus}
          onClose={() => setShowWatchlistModal(false)}
          onSelect={async status => {
            if (isInWatchlist) await updateWatchStatus(String(anime.mal_id), status);
            else await addToWatchlist(anime, status);
            setShowWatchlistModal(false);
          }}
        />
      )}
    </div>
  );
};

const WatchPage = () => {
  const { id } = useParams<{ id: string }>();
  const { saveWatchHistory, saveProgress, getProgress, addToWatchlist, removeFromWatchlist, watchlist, watchHistory, user, login } = useAuth();
  const { settings } = useSettings();
  const [anime, setAnime] = useState<Anime | null>(null);
  const isInWatchlist = anime ? watchlist.some(a => a.mal_id === String(anime.mal_id)) : false;
  const [resumeTime, setResumeTime] = useState(0);
  const progressSaveTimer = useRef<any>(null);
  const [episodes, setEpisodes] = useState<streamingService.Episode[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState<streamingService.Episode | null>(null);
  const [streamSource, setStreamSource] = useState<streamingService.StreamSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSource, setLoadingSource] = useState(false);
  const [error, setError] = useState('');
  const [streamError, setStreamError] = useState('');
  const EPISODE_PAGE_SIZE = 50;
  const [episodePage, setEpisodePage] = useState(0);
  const totalEpisodePages = Math.max(1, Math.ceil(episodes.length / EPISODE_PAGE_SIZE));
  const pageStart = episodes.length ? episodePage * EPISODE_PAGE_SIZE + 1 : 0;
  const pageEnd = episodes.length ? Math.min(episodes.length, episodePage * EPISODE_PAGE_SIZE + EPISODE_PAGE_SIZE) : 0;
  const pagedEpisodes = episodes.slice(
    episodePage * EPISODE_PAGE_SIZE,
    episodePage * EPISODE_PAGE_SIZE + EPISODE_PAGE_SIZE
  );

  useEffect(() => {
    setEpisodePage(0);
  }, [id]);

  useEffect(() => {
    const clamped = Math.max(0, totalEpisodePages - 1);
    if (episodePage > clamped) {
      setEpisodePage(clamped);
    }
  }, [episodes, episodePage, totalEpisodePages]);

  useEffect(() => {
    const init = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const fast = await jikanService.getAnimeFast(id);
        if (!fast) {
          setError('Anime not found.');
          return;
        }

        setAnime(fast.anime);

        const orderedEpisodes = [...fast.episodes].sort((a, b) => (a.number || 0) - (b.number || 0));
        setEpisodes(orderedEpisodes);
        setEpisodePage(0);

        if (orderedEpisodes.length > 0) {
          // Resume from the last watched episode if available
          const lastEntry = watchHistory.find(h => h.animeId === id);
          const startEp = lastEntry?.episodeNumber
            ? (orderedEpisodes.find(ep => ep.number === lastEntry.episodeNumber) ?? orderedEpisodes[0])
            : orderedEpisodes[0];
          handleEpisodeSelect(startEp, fast.anime);
        }
      } catch (err) {
        console.error(err);
        setError('Failed to load anime details.');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [id]);

  const handleEpisodeSelect = async (episode: streamingService.Episode, animeOverride?: Anime) => {
    setCurrentEpisode(episode);
    const index = episodes.findIndex(ep => ep.id === episode.id);
    if (index >= 0) {
      const targetPage = Math.floor(index / EPISODE_PAGE_SIZE);
      if (targetPage !== episodePage) setEpisodePage(targetPage);
    }
    setLoadingSource(true);
    setStreamSource(null);
    setStreamError('');
    // Clear previous progress save timer
    if (progressSaveTimer.current) clearInterval(progressSaveTimer.current);

    try {
      const source = await streamingService.getStreamSource(episode.id);
      if (!source || !source.sources?.length) {
        setStreamError('Stream unavailable for this episode right now.');
        setStreamSource(null);
        return;
      }
      setStreamSource(source);

      // Load saved resume time (prefer episode-number key for stability)
      const savedTime = id ? getProgress(id, episode.id, episode.number) : 0;
      setResumeTime(savedTime);

      // Save to watch history — use animeOverride for first load since anime state may not be set yet
      const animeData = animeOverride ?? anime;
      if (animeData) {
        saveWatchHistory({
          animeId: String(animeData.mal_id),
          animeTitle: animeData.title,
          animeImage: animeData.images.jpg.large_image_url,
          episodeId: episode.id,
          episodeNumber: episode.number,
          watchedAt: Date.now(),
        });
      }

      // Prefetch next 3 episodes into cache so switching feels instant
      const currentIndex = episodes.findIndex(ep => ep.id === episode.id);
      const toWarm = episodes.slice(currentIndex + 1, currentIndex + 4);
      toWarm.forEach(ep => streamingService.getStreamSource(ep.id).catch(() => { }));
    } catch (err) {
      console.error(err);
      setStreamError('Failed to load stream for this episode.');
    } finally {
      setLoadingSource(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#202125] flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand-500"></div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-[#202125] flex items-center justify-center text-red-400">
      <AlertCircle className="w-6 h-6 mr-2" /> {error}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#202125] pt-8 pb-24 md:pb-20 px-4 md:px-8">
      <div className="w-full max-w-[2500px] mx-auto">
        <Link to={`/anime/${id}`} className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition">
          <ChevronLeft className="w-4 h-4" /> Back to Details
        </Link>

        <div className="grid gap-6 xl:grid-cols-12">
          <div className="order-2 xl:order-1 xl:col-span-3 2xl:col-span-2">
            <div className="bg-[#1f2026] rounded-2xl border border-white/5 p-4 h-full flex flex-col">
              <div className="flex items-center justify-between text-sm text-gray-300">
                <h3 className="font-bold text-white">Episodes ({episodes.length})</h3>
                {currentEpisode && (
                  <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-white/70">
                    Playing EP {currentEpisode.number}
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-gray-400 gap-2">
                <button
                  onClick={() => setEpisodePage(p => Math.max(0, p - 1))}
                  disabled={episodePage === 0}
                  className="px-2 py-1 rounded bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10 text-white"
                >
                  Prev
                </button>
                <span className="font-semibold text-white">
                  EPS {String(pageStart || 0).padStart(3, '0')}-
                  {String(pageEnd || 0).padStart(3, '0')}
                </span>
                <button
                  onClick={() => setEpisodePage(p => Math.min(totalEpisodePages - 1, p + 1))}
                  disabled={episodePage >= totalEpisodePages - 1}
                  className="px-2 py-1 rounded bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10 text-white"
                >
                  Next
                </button>
              </div>
              <div className="mt-3 text-[11px] text-gray-500">
                Page {episodes.length ? episodePage + 1 : 0} / {episodes.length ? totalEpisodePages : 0}
              </div>
              <div className="mt-4 flex-1 overflow-y-auto custom-scrollbar pr-1">
                {episodes.length === 0 ? (
                  <EpisodeListSkeleton />
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {pagedEpisodes.map(ep => (
                      <button
                        key={ep.id}
                        onClick={() => handleEpisodeSelect(ep)}
                        className={`h-10 rounded-md border text-xs font-semibold transition ${currentEpisode?.id === ep.id
                          ? 'bg-brand-500 text-white border-brand-400 shadow-brand-500/30 shadow-lg'
                          : 'bg-black/30 text-gray-300 border-white/5 hover:border-brand-400 hover:text-white'
                          }`}
                      >
                        EP {ep.number || '?'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="order-1 xl:order-2 xl:col-span-6 2xl:col-span-8">
            <div className="aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl relative bg-[#151619] border border-white/5">
              {loadingSource && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
                  <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-brand-500"></div>
                </div>
              )}
              {streamSource ? (
                <VideoPlayer
                  src={streamSource.sources[0]?.url || ''}
                  headers={streamSource.headers}
                  isEmbed={streamSource.isEmbed}
                  startAt={resumeTime}
                  skipSeconds={settings.skipSeconds}
                  onProgress={(currentTime, duration) => {
                    if (!currentEpisode || !id) return;
                    if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
                    progressSaveTimer.current = setTimeout(() => {
                      saveProgress(id, currentEpisode.id, currentTime, duration, currentEpisode.number);
                    }, 5000); // save after 5s of no seeking
                  }}
                  onEnded={() => {
                    if (!settings.autoNext || !currentEpisode) return;
                    const idx = episodes.findIndex(ep => ep.id === currentEpisode.id);
                    if (idx >= 0 && idx < episodes.length - 1) {
                      handleEpisodeSelect(episodes[idx + 1]);
                    }
                  }}
                />
              ) : (
                !loadingSource && <div className="w-full h-full flex items-center justify-center text-gray-500 flex-col gap-2">
                  <PlayCircle className="w-10 h-10 opacity-50" />
                  <span>Select an episode to start watching</span>
                </div>
              )}
              {streamError && !loadingSource && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent text-center text-sm text-red-300 py-3">
                  {streamError}
                </div>
              )}
            </div>

            <div className="mt-6 bg-[#1f2026] rounded-2xl border border-white/5 p-4">
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                <span className="bg-brand-600/90 text-white px-3 py-1 rounded-full font-bold text-[11px] tracking-wide">
                  EP {currentEpisode?.number || '--'}
                </span>
                <span className="px-3 py-1 rounded-full bg-white/10 text-white/80">{anime?.type || 'TV'}</span>
                {anime?.rating && <span className="px-3 py-1 rounded-full bg-white/5">{anime.rating}</span>}
                {anime?.status && <span className="px-3 py-1 rounded-full bg-white/5">{anime.status}</span>}
                {anime?.episodes && <span className="px-3 py-1 rounded-full bg-white/5">{anime.episodes} Episodes</span>}
              </div>
              <h1 className="text-2xl font-bold text-white mt-4">{anime?.title}</h1>
              <p className="mt-3 text-gray-400 text-sm leading-relaxed">{anime?.synopsis}</p>
            </div>
          </div>

          <div className="order-3 xl:order-3 xl:col-span-3 2xl:col-span-2">
            <div className="bg-[#1f2026] rounded-2xl border border-white/5 p-4 flex flex-col gap-4">
              <div className="rounded-xl overflow-hidden border border-white/5">
                <img src={anime?.images.webp.large_image_url} alt={anime?.title} className="w-full h-64 object-cover object-top" />
              </div>
              <div className="space-y-3 text-sm text-gray-300">
                <div className="flex justify-between">
                  <span className="text-gray-500 uppercase tracking-wide text-[11px]">Year</span>
                  <span className="text-white font-semibold">{anime?.year || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 uppercase tracking-wide text-[11px]">Score</span>
                  <span className="text-white font-semibold">{anime?.score ?? 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 uppercase tracking-wide text-[11px]">Duration</span>
                  <span className="text-white font-semibold">{anime?.duration || '24m'}</span>
                </div>
                <div>
                  <p className="text-gray-500 uppercase tracking-wide text-[11px] mb-2">Genres</p>
                  <div className="flex flex-wrap gap-2">
                    {anime?.genres?.length ? (
                      anime.genres.map((genre) => (
                        <span key={genre.name} className="px-2 py-1 rounded-full bg-white/10 text-xs text-white/90">
                          {genre.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-gray-500 text-xs">—</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    if (!user) { login(); return; }
                    if (anime) isInWatchlist ? removeFromWatchlist(String(anime.mal_id)) : addToWatchlist(anime);
                  }}
                  className={`inline-flex items-center justify-center gap-2 text-sm font-bold py-2 rounded-full transition w-full ${isInWatchlist
                    ? 'bg-white/10 hover:bg-red-500/20 text-white hover:text-red-400 border border-white/10'
                    : 'bg-brand-500/20 hover:bg-brand-500 text-brand-400 hover:text-white border border-brand-500/30'
                    }`}
                >
                  <Heart className={`w-4 h-4 ${isInWatchlist ? 'fill-current text-brand-400' : ''}`} />
                  {isInWatchlist ? 'In My List' : 'Add to List'}
                </button>
                <Link
                  to={`/anime/${id}`}
                  className="inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-bold py-2 rounded-full transition"
                >
                  <Info className="w-4 h-4" /> View details
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SearchPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search).get('q');
  const filter = new URLSearchParams(location.search).get('filter');
  const [searchTerm, setSearchTerm] = useState(query ?? '');
  const [results, setResults] = useState<Anime[]>([]);
  const [pagination, setPagination] = useState<jikanService.PaginationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page when query/filter changes
  useEffect(() => {
    setCurrentPage(1);
    setSearchTerm(query ?? '');
  }, [query, filter]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      let data: jikanService.ApiResponse = { data: [], pagination: {} as any };

      if (filter === 'trending') {
        data = await jikanService.getSeasonalAnime(currentPage);
      }
      else if (filter === 'popular') {
        data = await jikanService.getPopularAnime(currentPage);
      }
      else if (query) {
        data = await jikanService.searchAnime(query, currentPage);
      }
      else {
        data = await jikanService.getTopAnime(currentPage);
      }

      setResults(data.data);
      setPagination(data.pagination);
      setLoading(false);
    };

    fetchData();
  }, [query, filter, currentPage]);

  const getTitle = () => {
    if (filter === 'trending') return 'Trending Now';
    if (filter === 'popular') return 'Most Popular';
    if (query) return `Results for "${query}"`;
    return 'Browse Anime';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchTerm.trim();
    navigate(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search');
  };

  return (
    <div className="min-h-screen pt-8 pb-24 md:pb-20 w-full max-w-[2500px] mx-auto px-4 bg-[#202125]">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-brand-100">
          {getTitle()}
        </h1>
        <form onSubmit={handleSubmit} className="w-full md:w-auto">
          <div className="relative max-w-lg w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search anime..."
              className="w-full bg-[#151619] text-gray-200 pl-9 pr-28 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/60 border border-white/5"
            />
            <button
              type="submit"
              className="absolute right-1 top-1/2 -translate-y-1/2 bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold transition"
            >
              Search
            </button>
          </div>
        </form>
      </div>
      {loading ? (
        <div className="flex justify-center pt-20">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-brand-500" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
            {results.map(anime => (
              <AnimeCard key={anime.mal_id} anime={anime} />
            ))}
          </div>

          {results.length === 0 && (
            <div className="text-center text-gray-500 py-20">No results found.</div>
          )}

          {pagination && pagination.last_visible_page > 1 && (
            <Pagination
              currentPage={currentPage}
              lastPage={pagination.last_visible_page}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      )}
    </div>
  );
};

// Banner preset gradients
const BANNER_PRESETS = [
  'linear-gradient(135deg, #1a0533 0%, #0d1b4b 50%, #0a2a1a 100%)',
  'linear-gradient(135deg, #3d0000 0%, #1a0533 50%, #0d1b4b 100%)',
  'linear-gradient(135deg, #0d1b4b 0%, #001a2e 50%, #0a2a1a 100%)',
  'linear-gradient(135deg, #2d1b00 0%, #3d0000 50%, #1a0533 100%)',
  'linear-gradient(135deg, #0a1a2a 0%, #0d2b1b 50%, #1a1a3d 100%)',
  'linear-gradient(135deg, #1a3d00 0%, #003d3d 50%, #00003d 100%)',
  'linear-gradient(135deg, #3d1a00 0%, #3d003d 50%, #00003d 100%)',
  'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a2d 100%)',
];

const formatTimeAgo = (ms: number) => {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
};

const groupByDate = (entries: import('./context/AuthContext').WatchHistoryEntry[]) => {
  const groups: Record<string, typeof entries> = {};
  entries.forEach(e => {
    const d = new Date(e.watchedAt);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    let label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (d.toDateString() === today.toDateString()) label = 'Today';
    else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday';
    if (!groups[label]) groups[label] = [];
    groups[label].push(e);
  });
  return groups;
};

const ProfilePage = () => {
  const { user, watchlist, watchHistory, removeFromWatchlist, updateWatchStatus, logout, addToWatchlist, userProfile, updateBio, updateBanner, updateListPrivacy, updateCustomPhoto, assignTagToUser, isAdmin, searchUsers } = useAuth();
  const { lang, setLang } = useTitleLang();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'watchlist' | 'mal' | 'settings'>('overview');
  const [editingBio, setEditingBio] = useState(false);
  const [bioInput, setBioInput] = useState('');
  const [showBannerPicker, setShowBannerPicker] = useState(false);
  const [showPhotoInput, setShowPhotoInput] = useState(false);
  const [photoUrlInput, setPhotoUrlInput] = useState('');
  const [savingPhoto, setSavingPhoto] = useState(false);
  // Admin tag assignment
  const [adminSearch, setAdminSearch] = useState('');
  const [adminResults, setAdminResults] = useState<import('./context/AuthContext').PublicUser[]>([]);
  const [tagTarget, setTagTarget] = useState<import('./context/AuthContext').PublicUser | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [adminSearching, setAdminSearching] = useState(false);
  // MAL import
  const [malFile, setMalFile] = useState<File | null>(null);
  const [malUsername, setMalUsername] = useState('');
  const [malImportMode, setMalImportMode] = useState<'oauth' | 'username' | 'xml'>('oauth');
  const [malMode, setMalMode] = useState<'merge' | 'replace'>('merge');
  const [malAccessToken, setMalAccessToken] = useState<string | null>(() => getStoredMALToken());
  const [malProfileName, setMalProfileName] = useState<string | null>(() => localStorage.getItem(MAL_PROFILE_KEY));
  const [malConnecting, setMalConnecting] = useState(false);
  const [malAuthMessage, setMalAuthMessage] = useState<string | null>(() => localStorage.getItem(MAL_AUTH_ERROR_KEY));
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; count?: number; total?: number; error?: string } | null>(null);
  // Watchlist filter
  const [watchStatusFilter, setWatchStatusFilter] = useState<string>('all');
  // Settings
  const { settings, updateSetting } = useSettings();

  useEffect(() => {
    const syncMAL = () => {
      setMalAccessToken(getStoredMALToken());
      setMalProfileName(localStorage.getItem(MAL_PROFILE_KEY));
      const err = localStorage.getItem(MAL_AUTH_ERROR_KEY);
      setMalAuthMessage(err);
      if (err) localStorage.removeItem(MAL_AUTH_ERROR_KEY);
    };
    syncMAL();
    window.addEventListener('mal-auth-changed', syncMAL);
    return () => window.removeEventListener('mal-auth-changed', syncMAL);
  }, []);

  if (!user) return (
    <div className="min-h-screen bg-[#202125] flex flex-col items-center justify-center gap-4 text-white">
      <p className="text-gray-400">You need to be logged in to view your profile.</p>
      <button onClick={() => navigate('/')} className="bg-brand-500 text-white px-6 py-2 rounded-full font-bold">Go Home</button>
    </div>
  );

  const banner = BANNER_PRESETS[userProfile.bannerIndex ?? 0];
  const joinDate = userProfile.joinedAt ? new Date(userProfile.joinedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : 'Unknown';
  const grouped = groupByDate(watchHistory);

  const handleAdminSearch = async () => {
    if (!adminSearch.trim()) return;
    setAdminSearching(true);
    const res = await searchUsers(adminSearch);
    setAdminResults(res);
    setAdminSearching(false);
  };

  const handleAssignTag = async () => {
    if (!tagTarget || !tagInput.trim()) return;
    await assignTagToUser(tagTarget.uid, tagInput.trim());
    setTagTarget(null);
    setTagInput('');
    setAdminResults([]);
    setAdminSearch('');
  };

  const handleSavePhotoUrl = async () => {
    if (!photoUrlInput.trim()) return;
    setSavingPhoto(true);
    try {
      await updateCustomPhoto(photoUrlInput.trim());
      setShowPhotoInput(false);
      setPhotoUrlInput('');
    } finally {
      setSavingPhoto(false);
    }
  };

  const MAL_STATUS_MAP: Record<number | string, string> = {
    1: 'Watching', 2: 'Completed', 3: 'On-Hold', 4: 'Dropped', 6: 'Plan to Watch',
    watching: 'Watching', completed: 'Completed', on_hold: 'On-Hold', dropped: 'Dropped', plan_to_watch: 'Plan to Watch',
  };
  const DEFAULT_POSTER = 'https://placehold.co/600x900?text=No+Image';

  const applyImport = async (toAdd: Anime[]) => {
    if (malMode === 'replace') await Promise.all(watchlist.map(a => removeFromWatchlist(a.mal_id)));
    const existingIds = new Set(watchlist.map(a => a.mal_id));
    const newEntries = malMode === 'merge' ? toAdd.filter(a => !existingIds.has(a.mal_id)) : toAdd;
    await Promise.all(newEntries.map(a => addToWatchlist(a, (a as any)._watchStatus)));
    setImportResult({ success: true, count: newEntries.length, total: toAdd.length });
  };

  const handleConnectMAL = async () => {
    setImportResult(null);
    setMalAuthMessage(null);
    try {
      setMalConnecting(true);
      await beginMALAuth();
    } catch (err: any) {
      setMalAuthMessage(err?.message || 'Unable to start MAL login. Check env vars.');
      setMalConnecting(false);
    }
  };

  const handleDisconnectMAL = () => {
    clearMALTokens();
    localStorage.removeItem(MAL_AUTH_ERROR_KEY);
    setMalAccessToken(null);
    setMalProfileName(null);
    setMalAuthMessage('Disconnected from MyAnimeList.');
  };

  const getValidMALToken = async () => {
    let token = getStoredMALToken();
    if (token) return token;
    token = await refreshMALToken();
    if (token) {
      await fetchMALProfile(token).catch(() => {});
      return token;
    }
    return null;
  };

  const handleMALImportOAuth = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      let token = await getValidMALToken();
      if (!token) throw new Error('Connect your MyAnimeList account first.');

      const statusMap = MAL_STATUS_MAP;
      const allItems: Anime[] = [];
      let next = 'https://api.myanimelist.net/v2/users/@me/animelist?limit=1000&fields=list_status{status,score,num_episodes_watched},media_type,num_episodes,main_picture';

      while (next) {
        const res = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) {
          token = await refreshMALToken();
          if (token) { await fetchMALProfile(token).catch(() => {}); continue; }
          throw new Error('MAL session expired. Please reconnect.');
        }
        if (!res.ok) throw new Error(`MAL API error (${res.status}).`);
        const json = await res.json();
        const items: Anime[] = (json.data ?? []).map((entry: any) => {
          const node = entry.node ?? {};
          const ls = entry.list_status ?? {};
          const pic = node.main_picture ?? {};
          const image = pic.large || pic.medium || DEFAULT_POSTER;
          return {
            mal_id: String(node.id),
            title: node.title,
            images: { jpg: { image_url: image, large_image_url: image }, webp: { image_url: image, large_image_url: image } },
            trailer: { youtube_id: '', url: '', embed_url: '', images: { image_url: image, small_image_url: image, medium_image_url: image, large_image_url: image, maximum_image_url: image } },
            synopsis: '', score: ls.score ?? null, year: null,
            episodes: node.num_episodes ?? 0, status: '', genres: [], rating: '',
            type: node.media_type || 'TV', duration: '', rank: undefined,
            _watchStatus: statusMap[ls.status as any] ?? 'Plan to Watch',
          } as any;
        });
        allItems.push(...items);
        next = json.paging?.next ?? null;
        if (next) await new Promise(r => setTimeout(r, 250));
      }

      if (allItems.length === 0) throw new Error('No anime found on this MAL account.');
      await applyImport(allItems);
      setMalAccessToken(getStoredMALToken());
      if (!malProfileName && token) await fetchMALProfile(token).catch(() => {});
    } catch (err: any) {
      setImportResult({ success: false, error: err.message || 'Import failed' });
    } finally {
      setImporting(false);
      setMalConnecting(false);
    }
  };

  const handleMALImportUsername = async () => {
    if (!malUsername.trim()) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch(`/api/mal-list?username=${encodeURIComponent(malUsername.trim())}`);
      if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(errTxt ? errTxt : 'Failed to fetch list');
      }
      const json = await res.json();
      const list = json.data as any[];
      if (!Array.isArray(list) || list.length === 0) throw new Error('No anime found on this MAL account.');

      const items: Anime[] = list.map((entry: any) => {
        const image = entry.anime_image_path || DEFAULT_POSTER;
        return {
          mal_id: String(entry.anime_id),
          title: entry.anime_title || entry.anime_title_eng || 'Untitled',
          images: { jpg: { image_url: image, large_image_url: image }, webp: { image_url: image, large_image_url: image } },
          trailer: { youtube_id: '', url: '', embed_url: '', images: { image_url: image, small_image_url: image, medium_image_url: image, large_image_url: image, maximum_image_url: image } },
          synopsis: '', score: entry.score ?? null, year: null,
          episodes: entry.anime_num_episodes ?? 0, status: '', genres: [], rating: '',
          type: entry.anime_media_type_string || 'TV', duration: '', rank: undefined,
          _watchStatus: MAL_STATUS_MAP[entry.status] ?? 'Plan to Watch',
        } as any;
      });

      await applyImport(items);
      setMalUsername('');
    } catch (err: any) {
      setImportResult({ success: false, error: err.message || 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  const handleMALImport = async () => {
    if (!malFile) return;
    setImporting(true);
    setImportResult(null);
    try {
      const xmlText = await malFile.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      if (doc.querySelector('parsererror')) throw new Error('Invalid XML file');
      const animeEls = Array.from(doc.querySelectorAll('anime'));
      if (animeEls.length === 0) throw new Error('No anime entries found. Make sure you uploaded an Anime List XML.');
      const xmlStatusMap: Record<string, string> = {
        'Watching': 'Watching', 'Completed': 'Completed',
        'On-Hold': 'On-Hold', 'Dropped': 'Dropped', 'Plan to Watch': 'Plan to Watch',
      };
      const toAdd: Anime[] = animeEls.map(el => {
        const get = (tag: string) => el.querySelector(tag)?.textContent?.trim() || '';
        const malId = get('series_animedb_id');
        const title = get('series_title');
        if (!malId || !title) return null;
        return {
          mal_id: malId, title,
          images: { jpg: { image_url: DEFAULT_POSTER, large_image_url: DEFAULT_POSTER }, webp: { image_url: DEFAULT_POSTER, large_image_url: DEFAULT_POSTER } },
          trailer: { youtube_id: '', url: '', embed_url: '', images: { image_url: DEFAULT_POSTER, small_image_url: DEFAULT_POSTER, medium_image_url: DEFAULT_POSTER, large_image_url: DEFAULT_POSTER, maximum_image_url: DEFAULT_POSTER } },
          synopsis: '', score: null, year: null,
          episodes: parseInt(get('series_episodes')) || 0,
          status: '', genres: [], rating: '',
          type: get('series_type') || 'TV', duration: '', rank: undefined,
          _watchStatus: xmlStatusMap[get('my_status')] ?? 'Plan to Watch',
        } as any;
      }).filter(Boolean) as Anime[];
      await applyImport(toAdd);
      setMalFile(null);
    } catch (err: any) {
      setImportResult({ success: false, error: err.message || 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#202125] pb-24 md:pb-20">
      {/* Banner */}
      <div className="relative h-48 md:h-64 w-full" style={{ background: banner }}>
        <div className="absolute inset-0 bg-gradient-to-t from-[#202125] to-transparent" />
        <button onClick={() => setShowBannerPicker(v => !v)}
          className="absolute top-3 right-3 bg-black/50 hover:bg-black/70 text-white text-xs px-3 py-1.5 rounded-lg backdrop-blur-sm border border-white/10 flex items-center gap-1.5 transition">
          <Edit3 className="w-3 h-3" /> Change Banner
        </button>
        {showBannerPicker && (
          <div className="absolute top-12 right-3 z-20 bg-[#1a1b1f] border border-white/10 rounded-xl p-3 shadow-2xl grid grid-cols-4 gap-2">
            {BANNER_PRESETS.map((bg, i) => (
              <button key={i} onClick={() => { updateBanner(i); setShowBannerPicker(false); }}
                className={`w-14 h-8 rounded-lg border-2 transition ${i === (userProfile.bannerIndex ?? 0) ? 'border-brand-500' : 'border-transparent hover:border-white/40'}`}
                style={{ background: bg }} />
            ))}
          </div>
        )}
      </div>

      {/* Profile card */}
      <div className="max-w-5xl mx-auto px-4 -mt-16 relative z-10">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 mb-6">
          {/* Avatar with change-photo popup */}
          <div className="relative flex-shrink-0">
            <div className="group cursor-pointer" onClick={() => { setShowPhotoInput(v => !v); setPhotoUrlInput(''); }}>
              <img
                src={userProfile.customPhotoURL || user.photoURL || ''}
                alt="avatar"
                className="w-24 h-24 rounded-full border-4 border-[#202125] object-cover shadow-2xl"
                onError={e => { if (user.photoURL) (e.target as HTMLImageElement).src = user.photoURL; }}
              />
              <div className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                <span className="text-white text-[10px] font-bold text-center leading-tight px-1">Change<br />Photo</span>
              </div>
            </div>
            {/* URL input popup */}
            {showPhotoInput && (
              <div className="absolute top-28 left-0 z-30 bg-[#1a1b1f] border border-white/10 rounded-xl p-3 shadow-2xl w-72">
                <p className="text-xs text-gray-400 mb-2">Paste an image URL for your profile photo:</p>
                <input
                  autoFocus
                  value={photoUrlInput}
                  onChange={e => setPhotoUrlInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSavePhotoUrl(); if (e.key === 'Escape') setShowPhotoInput(false); }}
                  placeholder="https://example.com/photo.jpg"
                  className="w-full bg-white/10 text-white text-xs px-3 py-2 rounded-lg border border-white/20 focus:outline-none focus:border-brand-500 mb-2"
                />
                <div className="flex gap-2">
                  <button onClick={handleSavePhotoUrl} disabled={savingPhoto || !photoUrlInput.trim()}
                    className="flex-1 bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold py-1.5 rounded-lg transition disabled:opacity-50">
                    {savingPhoto ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => setShowPhotoInput(false)}
                    className="px-3 bg-white/10 hover:bg-white/20 text-gray-300 text-xs font-bold py-1.5 rounded-lg transition">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 pb-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl font-black text-white">{user.displayName}</h1>
              {userProfile.customTag && (
                <span className="bg-brand-500/20 text-brand-400 border border-brand-500/30 text-xs font-bold px-2.5 py-0.5 rounded-full">{userProfile.customTag}</span>
              )}
            </div>
            <p className="text-gray-500 text-xs mb-2">{user.email} · Joined {joinDate}</p>
            {/* Bio */}
            {editingBio ? (
              <div className="flex gap-2 items-center">
                <input value={bioInput} onChange={e => setBioInput(e.target.value)} maxLength={120}
                  className="flex-1 bg-white/10 text-white text-sm px-3 py-1.5 rounded-lg border border-white/20 focus:outline-none focus:border-brand-500"
                  placeholder="Write a short bio..." autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') { updateBio(bioInput); setEditingBio(false); } if (e.key === 'Escape') setEditingBio(false); }} />
                <button onClick={() => { updateBio(bioInput); setEditingBio(false); }}
                  className="bg-brand-500 hover:bg-brand-600 text-white p-1.5 rounded-lg transition"><Check className="w-4 h-4" /></button>
              </div>
            ) : (
              <button onClick={() => { setBioInput(userProfile.bio || ''); setEditingBio(true); }}
                className="text-sm text-gray-400 hover:text-white flex items-center gap-1.5 transition group">
                <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" />
                {userProfile.bio || <span className="italic text-gray-600">Add a bio...</span>}
              </button>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Profile visibility toggle */}
            <button
              onClick={() => updateListPrivacy(userProfile.listPrivacy === 'public' ? 'private' : 'public')}
              className={`flex items-center gap-2 text-sm transition px-4 py-2 rounded-lg border font-medium ${userProfile.listPrivacy === 'public' ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20 border-green-500/20' : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border-white/5'}`}
              title={userProfile.listPrivacy === 'public' ? 'Lists are public — click to make private' : 'Lists are private — click to make public'}
            >
              <Globe className="w-4 h-4" />
              {userProfile.listPrivacy === 'public' ? 'Public Lists' : 'Private Lists'}
            </button>
            <button onClick={() => { logout(); navigate('/'); }}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-400 transition bg-white/5 hover:bg-red-500/10 px-4 py-2 rounded-lg border border-white/5">
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Watched', value: watchHistory.length, icon: '👁' },
            { label: 'Watchlist', value: watchlist.length, icon: '📚' },
            { label: 'Completed', value: watchHistory.filter(e => e.progress && e.progress >= 90).length, icon: '✅' },
          ].map(s => (
            <div key={s.label} className="bg-[#1a1b1f] border border-white/5 rounded-xl p-4 text-center">
              <div className="text-2xl mb-1">{s.icon}</div>
              <div className="text-xl font-black text-white">{s.value}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-[#1a1b1f] p-1 rounded-xl flex-wrap border border-white/5">
          {([
            { key: 'overview', label: 'Overview' },
            { key: 'history', label: 'History' },
            { key: 'watchlist', label: `Watchlist (${watchlist.length})` },
            { key: 'mal', label: 'MAL Import' },
            { key: 'settings', label: 'Settings' },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === key ? 'bg-brand-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Recent history preview */}
            <div>
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Recently Watched</h2>
              {watchHistory.length === 0
                ? <p className="text-gray-600 text-sm">Nothing watched yet.</p>
                : <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {watchHistory.slice(0, 6).map(e => (
                    <Link key={e.animeId} to={`/anime/${e.animeId}/watch`}
                      className="relative group rounded-xl overflow-hidden bg-[#1a1b1f] border border-white/5 hover:border-brand-500/40 transition">
                      <img src={e.animeImage} alt={e.animeTitle} className="w-full aspect-[2/3] object-cover" />
                      {e.progress != null && e.progress > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
                          <div className="h-full bg-brand-500" style={{ width: `${Math.min(e.progress, 100)}%` }} />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                        <Play className="w-8 h-8 text-white fill-white" />
                      </div>
                      <div className="p-2">
                        <p className="text-xs text-white font-semibold truncate">{e.animeTitle}</p>
                        <p className="text-[10px] text-brand-400">Ep {e.episodeNumber}</p>
                      </div>
                    </Link>
                  ))}
                </div>}
            </div>
            {/* Watchlist preview */}
            <div>
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">My List</h2>
              {watchlist.length === 0
                ? <p className="text-gray-600 text-sm">No anime saved yet.</p>
                : <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {watchlist.slice(0, 8).map(anime => (
                    <Link key={anime.mal_id} to={`/anime/${anime.mal_id}`}
                      className="group rounded-xl overflow-hidden bg-[#1a1b1f] border border-white/5 hover:border-brand-500/40 transition">
                      <img src={anime.images.webp.image_url} alt={anime.title} className="w-full aspect-[2/3] object-cover" />
                    </Link>
                  ))}
                </div>}
            </div>
          </div>
        )}

        {/* Watch History tab */}
        {activeTab === 'history' && (
          watchHistory.length === 0
            ? <p className="text-gray-500 text-sm">No watch history yet.</p>
            : Object.entries(grouped).map(([date, entries]) => (
              <div key={date} className="mb-8">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">{date}</h3>
                <div className="flex flex-col gap-2">
                  {entries.map(entry => (
                    <Link key={`${entry.animeId}-${entry.watchedAt}`} to={`/anime/${entry.animeId}/watch`}
                      className="flex items-center gap-4 p-3 rounded-xl bg-[#1f2026] hover:bg-[#2a2c31] border border-white/5 hover:border-brand-500/30 transition group">
                      <div className="relative w-24 h-16 rounded-lg overflow-hidden flex-shrink-0">
                        <img src={entry.animeImage} alt={entry.animeTitle} className="w-full h-full object-cover" />
                        {entry.progress != null && entry.progress > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                            <div className="h-full bg-brand-500" style={{ width: `${Math.min(entry.progress, 100)}%` }} />
                          </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/40">
                          <Play className="w-6 h-6 text-white fill-white" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{entry.animeTitle}</p>
                        <p className="text-xs text-brand-400 mt-0.5">Episode {entry.episodeNumber}</p>
                        {entry.progress != null && entry.progress > 0 && (
                          <p className="text-xs text-gray-500 mt-0.5">{entry.progress}% watched</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-600 flex-shrink-0">{formatTimeAgo(entry.watchedAt)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))
        )}

        {/* Watchlist tab */}
        {activeTab === 'watchlist' && (() => {
          const STATUS_FILTERS = [
            { key: 'all', label: 'All', color: '' },
            { key: 'Watching', label: 'Watching', color: 'bg-green-500' },
            { key: 'On-Hold', label: 'On-Hold', color: 'bg-yellow-500' },
            { key: 'Plan to Watch', label: 'Plan to Watch', color: 'bg-blue-500' },
            { key: 'Dropped', label: 'Dropped', color: 'bg-red-500' },
            { key: 'Completed', label: 'Completed', color: 'bg-purple-500' },
          ];
          const STATUS_COLORS: Record<string, string> = {
            'Watching': 'bg-green-500', 'On-Hold': 'bg-yellow-500',
            'Plan to Watch': 'bg-blue-500', 'Dropped': 'bg-red-500', 'Completed': 'bg-purple-500',
          };
          const STATUS_LABELS: Record<string, string> = {
            'Watching': 'Watching', 'On-Hold': 'On-Hold',
            'Plan to Watch': 'PTW', 'Dropped': 'Dropped', 'Completed': 'Completed',
          };
          const filtered = watchStatusFilter === 'all'
            ? watchlist
            : watchlist.filter(a => ((a as any)._watchStatus ?? '') === watchStatusFilter);

          return (
            <div>
              {/* Status filter tabs */}
              <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar pb-1">
                {STATUS_FILTERS.map(f => {
                  const count = f.key === 'all' ? watchlist.length : watchlist.filter(a => ((a as any)._watchStatus ?? '') === f.key).length;
                  return (
                    <button key={f.key} onClick={() => setWatchStatusFilter(f.key)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition border ${watchStatusFilter === f.key ? 'bg-white/15 text-white border-white/20' : 'text-gray-400 border-white/5 hover:text-white'}`}>
                      {f.color && <span className={`w-2 h-2 rounded-full ${f.color}`} />}
                      {f.label} <span className="opacity-60">({count})</span>
                    </button>
                  );
                })}
              </div>

              {filtered.length === 0
                ? <p className="text-gray-500 text-sm">No anime in this category.</p>
                : <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {filtered.map(anime => {
                    const currentStatus = (anime as any)._watchStatus ?? '';
                    return (
                      <div key={anime.mal_id} className="relative group">
                        <AnimeCard anime={anime} />
                        {/* Status badge */}
                        {currentStatus && (
                          <div className={`absolute top-2 left-2 ${STATUS_COLORS[currentStatus] || 'bg-gray-500'} text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow`}>
                            {STATUS_LABELS[currentStatus] || currentStatus}
                          </div>
                        )}
                        {/* Hover actions */}
                        <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button onClick={() => removeFromWatchlist(anime.mal_id)}
                            className="bg-red-600/90 hover:bg-red-500 text-white p-1.5 rounded-lg text-xs font-bold">✕</button>
                        </div>
                        {/* Status dropdown */}
                        <div className="absolute bottom-[52px] left-0 right-0 opacity-0 group-hover:opacity-100 transition px-1">
                          <select
                            value={currentStatus}
                            onChange={e => updateWatchStatus(anime.mal_id, e.target.value)}
                            onClick={e => e.stopPropagation()}
                            className="w-full bg-black/90 text-white text-[10px] font-semibold py-1 px-1.5 rounded border border-white/10 focus:outline-none cursor-pointer"
                          >
                            <option value="">— Set Status —</option>
                            <option value="Watching">Watching</option>
                            <option value="Plan to Watch">Plan to Watch</option>
                            <option value="Completed">Completed</option>
                            <option value="On-Hold">On-Hold</option>
                            <option value="Dropped">Dropped</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>}
            </div>
          );
        })()}

        {/* MAL Import tab */}
        {activeTab === 'mal' && (
          <div className="max-w-lg space-y-5">
            <div>
              <h2 className="text-lg font-bold text-white mb-1">MyAnimeList Import</h2>
              <p className="text-gray-400 text-sm">Sync your MAL anime list via the official API (OAuth) or fallback XML export.</p>
            </div>

            {/* Mode toggle */}
            <div className="flex bg-[#151619] rounded-xl overflow-hidden border border-white/5 p-1 gap-1">
              {(['oauth', 'username', 'xml'] as const).map(m => (
                <button key={m} onClick={() => { setMalImportMode(m); setImportResult(null); }}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${malImportMode === m ? 'bg-brand-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                  {m === 'oauth' ? '🔑 MAL Account' : m === 'username' ? '👤 Username' : '📄 XML File'}
                </button>
              ))}
            </div>

            {malImportMode === 'oauth' ? (
              <div className="space-y-4">
                <div className="bg-[#1a1b1f] border border-white/5 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Connection</p>
                      <p className="text-xs text-gray-400">
                        {malAccessToken ? (
                          <>Connected{malProfileName ? ` as ${malProfileName}` : ''}</>
                        ) : 'Not connected'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {malAccessToken && (
                        <button onClick={handleDisconnectMAL} className="text-xs text-gray-400 hover:text-white underline underline-offset-2">
                          Disconnect
                        </button>
                      )}
                      <button
                        onClick={handleConnectMAL}
                        disabled={malConnecting}
                        className="bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold px-3 py-2 rounded-lg transition disabled:opacity-60">
                        {malConnecting ? 'Opening…' : malAccessToken ? 'Reconnect' : 'Connect MAL'}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    Uses MAL OAuth (PKCE). We never see your password. Redirect URI must match VITE_MAL_REDIRECT_URI.
                  </p>
                  {malAuthMessage && (
                    <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/40 rounded-lg p-2">
                      {malAuthMessage}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wider mb-1.5 block">Import Mode</label>
                  <div className="flex gap-2">
                    {(['merge', 'replace'] as const).map(mode => (
                      <button key={mode} onClick={() => setMalMode(mode)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${malMode === mode ? 'bg-brand-500 text-white border-brand-500' : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'}`}>
                        {mode === 'merge' ? '🔀 Merge' : '♻️ Replace'}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={handleMALImportOAuth} disabled={importing || !malAccessToken}
                  className="w-full bg-brand-500 hover:bg-brand-600 text-white font-bold py-3 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2">
                  {importing
                    ? <><div className="animate-spin rounded-full h-4 w-4 border-t-2 border-white" /> Importing...</>
                    : '📥 Import from MyAnimeList'}
                </button>
              </div>
            ) : malImportMode === 'username' ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wider mb-1.5 block">MAL Username</label>
                  <input
                    value={malUsername}
                    onChange={e => { setMalUsername(e.target.value); setImportResult(null); }}
                    placeholder="e.g. your_mal_username"
                    className="w-full bg-[#1a1b1f] text-white px-4 py-3 rounded-xl border border-white/10 focus:outline-none focus:border-brand-500/50 transition text-sm"
                  />
                  <p className="text-xs text-gray-600 mt-1.5">Your MAL profile must be <span className="text-gray-400">Public</span>. Uses Jikan (public MAL mirror).</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wider mb-1.5 block">Import Mode</label>
                  <div className="flex gap-2">
                    {(['merge', 'replace'] as const).map(mode => (
                      <button key={mode} onClick={() => setMalMode(mode)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${malMode === mode ? 'bg-brand-500 text-white border-brand-500' : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'}`}>
                        {mode === 'merge' ? '🔀 Merge' : '♻️ Replace'}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={handleMALImportUsername} disabled={importing || !malUsername.trim()}
                  className="w-full bg-brand-500 hover:bg-brand-600 text-white font-bold py-3 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2">
                  {importing
                    ? <><div className="animate-spin rounded-full h-4 w-4 border-t-2 border-white" /> Importing...</>
                    : '📥 Import by Username'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wider mb-1.5 block">Anime List XML File</label>
                  <a href="https://myanimelist.net/panel.php?go=export" target="_blank" rel="noopener noreferrer"
                    className="text-xs text-brand-400 hover:text-brand-300 underline underline-offset-2 mb-3 block">
                    → Profile → Export → Anime List XML
                  </a>
                  <label className={`flex flex-col items-center justify-center gap-2 w-full py-8 rounded-xl border-2 border-dashed cursor-pointer transition ${malFile ? 'border-brand-500/60 bg-brand-500/5' : 'border-white/10 hover:border-white/30'}`}>
                    <input type="file" accept=".xml" className="hidden" onChange={e => { setMalFile(e.target.files?.[0] ?? null); setImportResult(null); }} />
                    {malFile
                      ? <><span className="text-2xl">📄</span><span className="text-sm text-white font-semibold">{malFile.name}</span><span className="text-xs text-gray-500">{(malFile.size / 1024).toFixed(1)} KB · Click to change</span></>
                      : <><span className="text-2xl">📂</span><span className="text-sm text-gray-400">Click to select XML file</span></>}
                  </label>
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wider mb-1.5 block">Import Mode</label>
                  <div className="flex gap-2">
                    {(['merge', 'replace'] as const).map(mode => (
                      <button key={mode} onClick={() => setMalMode(mode)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${malMode === mode ? 'bg-brand-500 text-white border-brand-500' : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'}`}>
                        {mode === 'merge' ? '🔀 Merge' : '♻️ Replace'}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={handleMALImport} disabled={importing || !malFile}
                  className="w-full bg-brand-500 hover:bg-brand-600 text-white font-bold py-3 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2">
                  {importing
                    ? <><div className="animate-spin rounded-full h-4 w-4 border-t-2 border-white" /> Importing...</>
                    : '📥 Import from XML'}
                </button>
              </div>
            )}

            {importResult && (
              <div className={`p-4 rounded-xl border text-sm ${importResult.success ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                {importResult.success
                  ? `✅ Imported ${importResult.count} anime${importResult.total && importResult.total !== importResult.count ? ` (${importResult.total! - importResult.count!} skipped — already in list)` : ''}`
                  : `❌ ${importResult.error}`}
              </div>
            )}
            <p className="text-xs text-gray-600">Statuses (Watching, Completed, etc.) are imported. Cover images load when you view each title.</p>
          </div>
        )}

        {/* Settings tab */}
        {activeTab === 'settings' && (
          <div className="max-w-lg space-y-6">
            <h2 className="text-lg font-bold text-white mb-1">Settings</h2>

            {/* Language */}
            <div className="bg-[#1a1b1f] border border-white/5 rounded-xl p-4">
              <h3 className="text-sm font-bold text-gray-300 mb-3 uppercase tracking-wider">Anime Title Language</h3>
              <div className="flex gap-2">
                {(['english', 'romaji'] as const).map(l => (
                  <button key={l} onClick={() => setLang(l)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold border transition ${lang === l ? 'bg-brand-500 text-white border-brand-500' : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'}`}>
                    {l === 'english' ? '🇺🇸 English' : '🇯🇵 Japanese (Romaji)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Playback */}
            <div className="bg-[#1a1b1f] border border-white/5 rounded-xl p-4 space-y-4">
              <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Playback</h3>
              {([
                { key: 'autoPlay', label: 'Auto-Play', description: 'Automatically start playing when episode loads' },
                { key: 'autoNext', label: 'Auto-Next Episode', description: 'Automatically play the next episode when current ends' },
                { key: 'autoSkipIntro', label: 'Auto-Skip Intro', description: 'Skip opening sequences automatically (when detected)' },
              ] as const).map(({ key, label, description }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                  </div>
                  <button onClick={() => updateSetting(key, !settings[key])}
                    className={`relative w-11 h-6 rounded-full transition flex-shrink-0 ${settings[key] ? 'bg-brand-500' : 'bg-white/10'}`}>
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings[key] ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              ))}

              {/* Skip seconds */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-white">Skip Duration</p>
                    <p className="text-xs text-gray-500 mt-0.5">Seconds to skip with J / L keys (or ← →)</p>
                  </div>
                  <span className="text-brand-400 font-bold text-sm">{settings.skipSeconds}s</span>
                </div>
                <div className="flex gap-2">
                  {[5, 10, 15, 30].map(s => (
                    <button key={s} onClick={() => updateSetting('skipSeconds', s)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition ${settings.skipSeconds === s ? 'bg-brand-500 text-white border-brand-500' : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'}`}>
                      {s}s
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Admin section — tag assignment */}
        {isAdmin && (
          <div className="mt-10 border-t border-white/5 pt-8">
            <h2 className="text-sm font-bold text-brand-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" /> Admin — Assign Tags
            </h2>
            <div className="flex gap-2 mb-4">
              <input value={adminSearch} onChange={e => setAdminSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdminSearch()}
                placeholder="Search user by name..."
                className="flex-1 bg-white/5 text-white text-sm px-3 py-2 rounded-lg border border-white/10 focus:outline-none focus:border-brand-500" />
              <button onClick={handleAdminSearch} disabled={adminSearching}
                className="bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition disabled:opacity-50">
                {adminSearching ? '...' : 'Search'}
              </button>
            </div>
            {tagTarget && (
              <div className="flex gap-2 mb-4 p-3 bg-white/5 rounded-lg border border-white/10 items-center">
                <img src={tagTarget.photoURL ?? ''} className="w-8 h-8 rounded-full object-cover" />
                <span className="text-sm text-white font-semibold flex-1">{tagTarget.displayName}</span>
                <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                  placeholder="Tag name (e.g. VIP, Mod)" maxLength={30}
                  className="bg-white/10 text-white text-sm px-3 py-1.5 rounded-lg border border-white/20 focus:outline-none focus:border-brand-500 w-44" />
                <button onClick={handleAssignTag} className="bg-brand-500 hover:bg-brand-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold transition">Assign</button>
                <button onClick={() => setTagTarget(null)} className="text-gray-500 hover:text-white text-xs">✕</button>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {adminResults.map(u => (
                <div key={u.uid} className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5 hover:border-white/20 transition">
                  <img src={u.photoURL ?? ''} className="w-9 h-9 rounded-full object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{u.displayName}</p>
                    {u.profile?.customTag && <span className="text-xs text-brand-400">{u.profile.customTag}</span>}
                  </div>
                  <button onClick={() => { setTagTarget(u); setTagInput(u.profile?.customTag || ''); }}
                    className="text-xs bg-white/10 hover:bg-brand-500 text-white px-3 py-1 rounded-lg transition font-bold">
                    Set Tag
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Community / User Search ---

// ─── Manga Card ──────────────────────────────────────────────────────────────
const MangaCard = ({ manga }: { manga: Manga }) => {
  const { lang } = useTitleLang();
  const title = lang === 'romaji' ? manga.title_romaji || manga.title : manga.title_english || manga.title;
  return (
    <Link to={`/manga/${manga.mal_id}`} className="group relative block w-full">
      <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-[#2a2c31]">
        <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 items-end">
          <span className="bg-purple-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
            {manga.type || 'MANGA'}
          </span>
          {manga.chapters && <span className="bg-brand-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">CH {manga.chapters}</span>}
        </div>
        <img src={manga.images.jpg.image_url} alt={title}
          className="w-full h-full object-cover object-top transition duration-500 group-hover:scale-105 group-hover:opacity-80" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-300 backdrop-blur-[2px] bg-black/20">
          <div className="bg-purple-600 rounded-full w-14 h-14 flex items-center justify-center shadow-xl transform scale-50 group-hover:scale-100 transition">
            <BookOpen className="w-6 h-6 text-white" />
          </div>
        </div>
      </div>
      <div className="mt-2.5">
        <h3 className="text-white font-semibold text-sm line-clamp-1 group-hover:text-purple-400 transition">{title}</h3>
        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
          <span>{manga.type || 'Manga'}</span>
          {manga.score && <><span className="w-1 h-1 rounded-full bg-gray-600" /><span className="text-yellow-400 flex items-center gap-0.5"><Star className="w-3 h-3 fill-current" />{manga.score.toFixed(1)}</span></>}
        </div>
      </div>
    </Link>
  );
};

// ─── Manga Home Page ─────────────────────────────────────────────────────────
const MangaPage = () => {
  const [spotlight, setSpotlight] = useState<Manga[]>([]);
  const [trending, setTrending] = useState<Manga[]>([]);
  const [popular, setPopular] = useState<Manga[]>([]);
  const [manhwa, setManhwa] = useState<Manga[]>([]);
  const [loading, setLoading] = useState(true);
  const [heroIndex, setHeroIndex] = useState(0);
  const [mangaSidebarTab, setMangaSidebarTab] = useState<'trending' | 'popular'>('trending');
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, duration: 20 }, [Autoplay({ delay: 6000, stopOnInteraction: false })]);

  const onSelect = useCallback(() => { if (emblaApi) setHeroIndex(emblaApi.selectedScrollSnap()); }, [emblaApi]);
  useEffect(() => { if (!emblaApi) return; onSelect(); emblaApi.on('select', onSelect); return () => { emblaApi.off('select', onSelect); }; }, [emblaApi, onSelect]);

  useEffect(() => {
    Promise.all([
      mangaService.getSpotlight(),
      mangaService.getTrendingManga(1),
      mangaService.getPopularManga(1),
      mangaService.getPopularManhwa(1),
    ]).then(([sp, t, p, m]) => {
      setSpotlight(sp.length > 0 ? sp : t.data.slice(0, 8));
      setTrending(t.data);
      setPopular(p.data);
      setManhwa(m.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-[#202125] pb-24">
      <div className="h-[60vh] bg-[#151619] animate-pulse" />
      <div className="max-w-[2500px] mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => <AnimeCardSkeleton key={i} />)}
        </div>
      </div>
    </div>
  );

  const heroList = spotlight.length > 0 ? spotlight : trending.slice(0, 8);

  return (
    <div className="min-h-screen bg-[#202125] pb-24 md:pb-20">
      {/* Hero */}
      {heroList.length > 0 && (
        <div className="relative h-[58vh] w-full overflow-hidden bg-[#151619]">
          <div className="absolute inset-0 overflow-hidden" ref={emblaRef}>
            <div className="flex h-full touch-pan-y select-none">
              {heroList.map((manga, idx) => {
                const banner = manga.images.jpg.large_image_url;
                const title = manga.title_english || manga.title;
                return (
                  <div key={String(manga.mal_id)} className="relative min-w-full h-full flex-[0_0_100%]">
                    <div className="absolute inset-0 z-0">
                      <div className="absolute right-0 top-0 w-full md:w-[70%] h-full bg-no-repeat bg-cover bg-center"
                        style={{ backgroundImage: `url(${banner})`, maskImage: 'linear-gradient(90deg,transparent 0%,black 25%,black 100%)', WebkitMaskImage: 'linear-gradient(90deg,transparent 0%,black 25%,black 100%)' }} />
                      <div className="absolute inset-0 bg-gradient-to-r from-[#202125] via-[#202125]/80 to-transparent" />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#202125] via-transparent to-[#202125]/30" />
                    </div>
                    <div className="absolute inset-0 flex items-center z-10">
                      <div className="w-full max-w-[2500px] mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="flex items-center gap-6 max-w-3xl">
                          <div className="hidden md:block flex-shrink-0 w-32 rounded-xl overflow-hidden shadow-2xl border border-white/10">
                            <img src={manga.images.jpg.image_url} alt={title} className="w-full h-auto object-cover" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-purple-400 font-bold text-xs tracking-widest uppercase mb-2">#{idx + 1} Trending</div>
                            <h1 className="text-3xl md:text-5xl font-black text-white mb-3 leading-tight line-clamp-2">{title}</h1>
                            <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
                              <div className="flex items-center gap-3 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/5 text-white">
                                <span className="flex items-center gap-1"><BookOpen className="w-3 h-3 text-purple-400" /> {manga.type || 'Manga'}</span>
                                {manga.chapters && <><span className="w-px h-3 bg-white/20" /><span>{manga.chapters} ch</span></>}
                              </div>
                              {manga.score && <span className="bg-yellow-400 text-black font-black px-2.5 py-1 rounded text-xs flex items-center gap-1"><Star className="w-3 h-3 fill-current" />{manga.score.toFixed(1)}</span>}
                              <span className="bg-purple-600 text-white text-xs font-bold px-2.5 py-1 rounded">{manga.status || 'MANGA'}</span>
                            </div>
                            <p className="text-gray-300 text-sm mb-5 line-clamp-2 max-w-xl">{manga.synopsis}</p>
                            <Link to={`/manga/${manga.mal_id}`}
                              className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-full font-bold flex items-center gap-2 transition shadow-lg shadow-purple-500/25 text-sm w-fit">
                              <BookOpen className="w-4 h-4" /> Read Now
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Dots */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex gap-2">
            {heroList.map((_, idx) => (
              <button key={idx} onClick={() => emblaApi?.scrollTo(idx)}
                className={`rounded-full transition-all duration-300 ${idx === heroIndex ? 'bg-purple-400 w-6 h-2' : 'bg-white/30 hover:bg-white/50 w-2 h-2'}`} />
            ))}
          </div>
        </div>
      )}

      <div className="w-full max-w-[2500px] mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        <div className="flex flex-col lg:flex-row gap-8">

          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-12">
            {trending.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-xl font-bold text-white uppercase tracking-tight">Trending Manga</h2>
                  <Link to="/manga/search?filter=trending" className="text-xs text-gray-400 hover:text-purple-400 flex items-center gap-1">View All <ChevronRight className="w-3 h-3" /></Link>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7 gap-4">
                  {trending.map(m => <MangaCard key={String(m.mal_id)} manga={m} />)}
                </div>
              </section>
            )}

            {popular.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-xl font-bold text-white uppercase tracking-tight">All-Time Popular</h2>
                  <Link to="/manga/search?filter=popular" className="text-xs text-gray-400 hover:text-purple-400 flex items-center gap-1">View All <ChevronRight className="w-3 h-3" /></Link>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7 gap-4">
                  {popular.slice(0, 12).map(m => <MangaCard key={String(m.mal_id)} manga={m} />)}
                </div>
              </section>
            )}

            {manhwa.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-xl font-bold text-white uppercase tracking-tight">Popular Manhwa</h2>
                  <Link to="/manga/search?filter=manhwa" className="text-xs text-gray-400 hover:text-purple-400 flex items-center gap-1">View All <ChevronRight className="w-3 h-3" /></Link>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7 gap-4">
                  {manhwa.slice(0, 12).map(m => <MangaCard key={String(m.mal_id)} manga={m} />)}
                </div>
              </section>
            )}
          </div>

          {/* Sidebar — Top Manga */}
          <div className="hidden lg:block w-72 flex-shrink-0">
            <div className="bg-[#2a2c31] rounded-xl p-4 sticky top-24 border border-purple-500/10">
              <div className="mb-4 border-b border-white/5 pb-3">
                <h3 className="text-base font-bold text-white mb-3">Top Manga</h3>
                <div className="flex items-center bg-[#151619] rounded-lg overflow-hidden border border-white/5 w-full">
                  {(['trending', 'popular'] as const).map(tab => (
                    <button key={tab} onClick={() => setMangaSidebarTab(tab)}
                      className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wide transition
                        ${mangaSidebarTab === tab ? 'bg-purple-600 text-white' : 'text-gray-500 hover:text-white'}`}>
                      {tab === 'trending' ? 'Trending' : 'Popular'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-0">
                {(mangaSidebarTab === 'trending' ? trending : popular).slice(0, 10).map((m, idx) => (
                  <Link key={String(m.mal_id)} to={`/manga/${m.mal_id}`}
                    className="flex gap-3 items-center p-2 rounded-lg hover:bg-white/5 transition border-b border-white/5 last:border-0 group">
                    <div className={`flex-shrink-0 w-7 text-center font-black text-xl ${idx < 3 ? 'text-purple-400' : 'text-gray-600'}`}>
                      {idx + 1}
                    </div>
                    <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-gray-800">
                      <img src={m.images.jpg.image_url} alt="" className="w-full h-full object-cover object-top" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white truncate group-hover:text-purple-400 transition">{m.title_english || m.title}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[10px] text-gray-500">{m.type || 'Manga'}</span>
                        {m.score && <><span className="w-1 h-1 rounded-full bg-gray-700" /><span className="text-[10px] text-yellow-400 flex items-center gap-0.5"><Star className="w-2.5 h-2.5 fill-current" />{m.score}</span></>}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

// ─── Manga Details Page ───────────────────────────────────────────────────────
const MangaDetailsPage = () => {
  const { id } = useParams<{ id: string }>();
  const { lang } = useTitleLang();
  const navigate = useNavigate();
  const [manga, setManga] = useState<Manga | null>(null);
  const [chapters, setChapters] = useState<MangaChapter[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    mangaService.getMangaByAnilistId(id).then(data => {
      setManga(data);
      setLoading(false);
      if (data?.scraper_id) {
        setLoadingChapters(true);
        mangaService.getChapters(data.scraper_id).then(setChapters).finally(() => setLoadingChapters(false));
      }
    }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return <DetailsSkeleton />;
  if (!manga) return <div className="min-h-screen bg-[#202125] flex items-center justify-center text-white text-xl">Manga not found.</div>;

  const title = lang === 'romaji' ? manga.title_romaji || manga.title : manga.title_english || manga.title;
  const banner = manga.images.jpg.large_image_url;

  return (
    <div className="min-h-screen bg-[#202125] pb-24 md:pb-20">
      {/* Banner */}
      <div className="h-[350px] w-full relative">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${banner})` }} />
        <div className="absolute inset-0 bg-[#202125]/70 backdrop-blur-sm" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#202125] to-transparent" />
      </div>

      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 -mt-56 relative z-10">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Cover */}
          <div className="w-44 md:w-56 flex-shrink-0 mx-auto md:mx-0">
            <div className="rounded-xl overflow-hidden shadow-2xl border border-white/10">
              <img src={manga.images.jpg.image_url} alt={title} className="w-full h-auto object-cover" />
            </div>
            <Link to={chapters.length > 0 ? `/manga/${id}/read/${encodeURIComponent(chapters[chapters.length - 1].id)}` : '#'}
              className={`mt-3 flex items-center justify-center gap-2 py-3 rounded-full font-bold text-sm transition w-full ${chapters.length > 0 ? 'bg-purple-600 hover:bg-purple-500 text-white' : 'bg-white/10 text-gray-500 cursor-not-allowed'}`}>
              <BookOpen className="w-4 h-4" />
              {loadingChapters ? 'Loading...' : chapters.length > 0 ? 'Start Reading' : 'No Chapters'}
            </Link>
          </div>

          {/* Info */}
          <div className="flex-1 pt-4 md:pt-20">
            <h1 className="text-3xl md:text-5xl font-black text-white mb-4 leading-tight">{title}</h1>
            {manga.title_native && lang === 'romaji' && <p className="text-gray-400 text-sm mb-4">{manga.title_native}</p>}

            <div className="flex flex-wrap gap-2 mb-6">
              {manga.score && <span className="bg-yellow-400 text-black font-black px-3 py-1 rounded text-sm flex items-center gap-1"><Star className="w-3 h-3 fill-current" />{manga.score.toFixed(1)}</span>}
              <span className="bg-purple-600 text-white px-3 py-1 rounded text-sm font-bold">{manga.type || 'Manga'}</span>
              <span className="bg-white/10 text-white px-3 py-1 rounded text-sm">{manga.status}</span>
              {manga.chapters && <span className="bg-white/10 text-white px-3 py-1 rounded text-sm">{manga.chapters} Chapters</span>}
              {manga.volumes && <span className="bg-white/10 text-white px-3 py-1 rounded text-sm">{manga.volumes} Volumes</span>}
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              {manga.genres?.map(g => <span key={g.name} className="bg-purple-900/40 text-purple-300 border border-purple-500/30 px-3 py-1 rounded-full text-xs font-semibold">{g.name}</span>)}
            </div>

            {manga.synopsis && <p className="text-gray-300 text-sm leading-relaxed mb-8 max-w-3xl">{manga.synopsis}</p>}

            {/* Chapter List */}
            <div>
              <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-purple-400" />
                Chapters {chapters.length > 0 && <span className="text-gray-500 text-sm font-normal">({chapters.length})</span>}
              </h2>
              {loadingChapters ? (
                <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />)}</div>
              ) : chapters.length === 0 ? (
                <div className="bg-white/5 rounded-xl p-6 text-center">
                  <p className="text-gray-500 text-sm">No chapters available yet.</p>
                  <p className="text-gray-600 text-xs mt-1">Chapter data may not be indexed for this title.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                  {[...chapters].reverse().map((ch, idx) => (
                    <Link key={ch.id} to={`/manga/${id}/read/${encodeURIComponent(ch.id)}`}
                      state={{ chapters, currentIndex: chapters.length - 1 - idx }}
                      className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-purple-900/30 hover:border-purple-500/30 border border-transparent transition group">
                      <div className="w-8 h-8 rounded-lg bg-purple-900/50 flex items-center justify-center flex-shrink-0">
                        <BookOpen className="w-4 h-4 text-purple-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white group-hover:text-purple-300 transition truncate">{ch.title}</p>
                        {ch.uploadDate && <p className="text-xs text-gray-500">{new Date(ch.uploadDate).toLocaleDateString()}</p>}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-purple-400 flex-shrink-0" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Manga Reader Page ────────────────────────────────────────────────────────
const MangaReaderPage = () => {
  const { id, chapterId } = useParams<{ id: string; chapterId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { chapters: stateChapters, currentIndex: stateIndex } = (location.state as any) || {};
  const [pages, setPages] = useState<{ pageNumber: number; imageUrl: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [chapters, setChapters] = useState<MangaChapter[]>(stateChapters || []);
  const [currentIndex, setCurrentIndex] = useState<number>(stateIndex ?? -1);
  const [chapterUrl, setChapterUrl] = useState('');
  const [showControls, setShowControls] = useState(true);

  // Find chapter URL from chapterId
  useEffect(() => {
    if (!chapterId) return;
    const decoded = decodeURIComponent(chapterId);
    const chapter = chapters.find(c => c.id === decoded);
    if (chapter?.url) {
      setChapterUrl(chapter.url);
    }
  }, [chapterId, chapters]);

  useEffect(() => {
    if (!chapterUrl) return;
    setLoading(true);
    setPages([]);
    mangaService.getChapterPages(chapterUrl).then(setPages).catch(console.error).finally(() => setLoading(false));
  }, [chapterUrl]);

  // Hide controls on scroll
  useEffect(() => {
    let timer: any;
    const onScroll = () => { setShowControls(false); clearTimeout(timer); timer = setTimeout(() => setShowControls(true), 2000); };
    window.addEventListener('scroll', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(timer); };
  }, []);

  const goToChapter = (dir: 'prev' | 'next') => {
    if (chapters.length === 0 || currentIndex < 0) return;
    const nextIdx = dir === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (nextIdx < 0 || nextIdx >= chapters.length) return;
    const ch = chapters[nextIdx];
    navigate(`/manga/${id}/read/${encodeURIComponent(ch.id)}`, { state: { chapters, currentIndex: nextIdx } });
    setCurrentIndex(nextIdx);
    window.scrollTo(0, 0);
  };

  const currentChapter = chapters[currentIndex];

  return (
    <div className="min-h-screen bg-[#0d0d0d] relative">
      {/* Top bar */}
      <div className={`fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-md border-b border-white/10 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex items-center gap-3 px-4 h-14 max-w-4xl mx-auto">
          <Link to={`/manga/${id}`} className="text-gray-400 hover:text-white transition p-2 rounded-lg hover:bg-white/10">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm truncate">{currentChapter?.title || 'Reading...'}</p>
          </div>
          {chapters.length > 0 && (
            <select value={currentIndex} onChange={e => { const i = Number(e.target.value); const ch = chapters[i]; navigate(`/manga/${id}/read/${encodeURIComponent(ch.id)}`, { state: { chapters, currentIndex: i } }); setCurrentIndex(i); window.scrollTo(0, 0); }}
              className="bg-white/10 text-white text-xs rounded-lg px-2 py-1 border border-white/10 max-w-[140px]">
              {[...chapters].reverse().map((ch, i) => <option key={ch.id} value={chapters.length - 1 - i} className="bg-[#1a1a1a]">{ch.title}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Pages */}
      <div className="pt-14 pb-24 max-w-3xl mx-auto px-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="w-10 h-10 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Loading chapter...</p>
          </div>
        ) : pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-3">
            <BookOpen className="w-12 h-12 opacity-30" />
            <p>No pages available for this chapter.</p>
          </div>
        ) : (
          pages.map(p => (
            <div key={p.pageNumber} className="mb-1">
              <img src={p.imageUrl} alt={`Page ${p.pageNumber}`}
                className="w-full h-auto block" loading="lazy"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
          ))
        )}
      </div>

      {/* Bottom nav */}
      <div className={`fixed bottom-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-md border-t border-white/10 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex items-center justify-between gap-3 px-4 h-14 max-w-4xl mx-auto">
          <button onClick={() => goToChapter('prev')} disabled={currentIndex <= 0}
            className="flex items-center gap-2 text-sm font-bold text-white disabled:text-gray-600 hover:text-purple-400 transition">
            <ChevronLeft className="w-5 h-5" /> Prev
          </button>
          <span className="text-xs text-gray-500">{pages.length > 0 ? `${pages.length} pages` : ''}</span>
          <button onClick={() => goToChapter('next')} disabled={currentIndex >= chapters.length - 1}
            className="flex items-center gap-2 text-sm font-bold text-white disabled:text-gray-600 hover:text-purple-400 transition">
            Next <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Manga Search Page ────────────────────────────────────────────────────────
const MangaSearchPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search).get('q') || '';
  const filterParam = new URLSearchParams(location.search).get('filter') || '';
  const [results, setResults] = useState<Manga[]>([]);
  const [pagination, setPagination] = useState<{ last_visible_page: number; current_page: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [localQuery, setLocalQuery] = useState(query);

  useEffect(() => { setCurrentPage(1); setLocalQuery(query); }, [query, filterParam]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        let res: { data: Manga[]; pagination: { last_visible_page: number; has_next_page: boolean; current_page: number } };
        if (query) {
          res = await mangaService.searchManga(query, currentPage, 18);
        } else if (filterParam === 'manhwa') {
          res = await mangaService.getPopularManhwa(currentPage);
        } else if (filterParam === 'popular') {
          res = await mangaService.getPopularManga(currentPage);
        } else {
          res = await mangaService.getTrendingManga(currentPage);
        }
        setResults(res.data);
        setPagination(res.pagination);
      } catch { setResults([]); }
      setLoading(false);
    };
    load();
  }, [query, filterParam, currentPage]);

  const title = query ? `Results for "${query}"` : filterParam === 'popular' ? 'All-Time Popular' : filterParam === 'manhwa' ? 'Popular Manhwa' : 'Trending Manga';

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (localQuery.trim()) navigate(`/manga/search?q=${encodeURIComponent(localQuery.trim())}`);
  };

  return (
    <div className="min-h-screen bg-[#202125] pb-24 md:pb-20">
      <div className="bg-gradient-to-b from-purple-500/5 to-transparent py-8 px-4 border-b border-purple-500/10">
        <div className="max-w-[2500px] mx-auto">
          <h1 className="text-2xl font-bold text-white mb-4">{title}</h1>
          <form onSubmit={handleSearch} className="flex gap-2 max-w-xl">
            <input
              value={localQuery}
              onChange={e => setLocalQuery(e.target.value)}
              placeholder="Search manga titles..."
              className="flex-1 bg-[#1a1b1f] text-white px-4 py-2.5 rounded-l-lg border border-purple-500/20 focus:outline-none focus:border-purple-500/50 transition"
            />
            <button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white px-5 py-2.5 rounded-r-lg transition flex items-center gap-2 font-bold text-sm">
              <Search className="w-4 h-4" /> Search
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-[2500px] mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
            {Array.from({ length: 18 }).map((_, i) => <AnimeCardSkeleton key={i} />)}
          </div>
        ) : results.length === 0 ? (
          <div className="text-center text-gray-500 py-20">No manga found.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
              {results.map(m => <MangaCard key={String(m.mal_id)} manga={m} />)}
            </div>
            {pagination && pagination.last_visible_page > 1 && (
              <Pagination currentPage={currentPage} lastPage={pagination.last_visible_page} onPageChange={p => { setCurrentPage(p); window.scrollTo(0, 0); }} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ─── About / Credits Page ─────────────────────────────────────────────────────
const AboutPage = () => (
  <div className="min-h-screen bg-[#202125] pb-24 md:pb-20">
    {/* Hero */}
    <div className="relative py-20 px-4 text-center overflow-hidden border-b border-white/5">
      <div className="absolute inset-0 bg-gradient-to-b from-brand-500/8 to-transparent pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-brand-500/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="relative z-10 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 rounded-full px-4 py-1.5 text-xs text-brand-400 font-bold uppercase tracking-widest mb-6">
          About This Project
        </div>
        <h1 className="text-4xl sm:text-5xl font-black text-white mb-4 leading-tight">
          Ani<span className="text-brand-500">Web</span> Stream
        </h1>
        <p className="text-gray-400 text-base leading-relaxed">
          A free, open anime &amp; manga streaming platform — no ads, no subscriptions, built with love.
        </p>
      </div>
    </div>

    <div className="max-w-3xl mx-auto px-4 py-16 space-y-14">
      {/* Creator */}
      <section className="text-center">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-[0.3em] mb-8">Created By</h2>
        <div className="inline-flex flex-col items-center gap-4 bg-[#1a1b1f] border border-white/5 rounded-2xl px-12 py-10 shadow-2xl">
          <img src="/JaypeeProfile.jpg" alt="Jaypee"
            className="w-24 h-24 rounded-full object-cover shadow-xl shadow-brand-500/20 border-2 border-brand-500/40" />
          <div>
            <h3 className="text-2xl font-black text-white">Jaypee</h3>
            <p className="text-brand-400 text-sm font-bold mt-1">Web Developer &amp; Designer</p>
          </div>
          <p className="text-gray-400 text-sm text-center max-w-sm leading-relaxed">
            I created this so I can watch anime ads free teehee!
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-500 bg-white/5 border border-white/5 rounded-full px-4 py-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400" /> dpodevmail@gmail.com
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section>
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-[0.3em] mb-6 text-center">Built With</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { name: 'React 18', desc: 'UI Framework' },
            { name: 'TypeScript', desc: 'Type Safety' },
            { name: 'Tailwind CSS', desc: 'Styling' },
            { name: 'Firebase', desc: 'Auth & Database' },
            { name: 'AniList API', desc: 'Anime & Manga Data' },
            { name: 'Embla Carousel', desc: 'Hero Slider' },
          ].map(t => (
            <div key={t.name} className="bg-[#1a1b1f] border border-white/5 rounded-xl p-4 text-center hover:border-brand-500/20 transition">
              <p className="text-white font-bold text-sm">{t.name}</p>
              <p className="text-gray-500 text-xs mt-0.5">{t.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Disclaimer */}
      <section className="bg-[#1a1b1f] border border-white/5 rounded-xl p-6 text-sm text-gray-400 leading-relaxed text-center">
        <p className="font-bold text-white mb-2">Disclaimer</p>
        AniWeb Stream does not host any media files. All content is sourced from third-party providers for personal, non-commercial use. Anime titles, characters, and related media are property of their respective owners.
      </section>
    </div>
  </div>
);

const CommunityPage = () => {
  const { searchUsers, onlineUsers, onlineUserIds, user, getUserPublicProfile } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<import('./context/AuthContext').PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const searchTimer = useRef<any>(null);

  useEffect(() => {
    const loadUsers = async () => {
      const r = await searchUsers('');
      // Ensure the current logged-in user appears in the list
      if (user && !r.find(u => u.uid === user.uid)) {
        const selfProfile = await getUserPublicProfile(user.uid);
        if (selfProfile) r.unshift(selfProfile);
      }
      setResults(r);
      setLoading(false);
    };
    loadUsers();
  }, [user]);

  const handleSearch = (val: string) => {
    setQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setLoading(true);
      const r = await searchUsers(val);
      // Ensure self appears even in search results
      if (user && !r.find(u => u.uid === user.uid)) {
        const selfProfile = await getUserPublicProfile(user.uid);
        if (selfProfile) {
          const matchesQuery = !val.trim() ||
            selfProfile.displayName.toLowerCase().includes(val.toLowerCase());
          if (matchesQuery) r.unshift(selfProfile);
        }
      }
      setResults(r);
      setLoading(false);
    }, 350);
  };

  // Always include the current logged-in user in online counts (they're here right now)
  const effectiveOnlineIds = user
    ? [...new Set([...onlineUserIds, user.uid])]
    : onlineUserIds;
  const effectiveMembers = user ? Math.max(onlineUsers.members, 1) : onlineUsers.members;
  const totalOnline = effectiveMembers + onlineUsers.guests;

  return (
    <div className="min-h-screen bg-[#202125] pb-24 md:pb-20">
      {/* Hero */}
      <div className="bg-gradient-to-b from-brand-500/10 to-transparent py-14 px-4 text-center border-b border-white/5">
        <Users className="w-10 h-10 text-brand-400 mx-auto mb-3" />
        <h1 className="text-3xl font-black text-white mb-2">Community</h1>
        <p className="text-gray-400 text-sm mb-4">Discover and connect with other anime fans</p>

        {/* Online counter */}
        <div className="inline-flex items-center gap-4 bg-[#1a1b1f] border border-white/10 rounded-full px-5 py-2 mb-6 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-white font-bold">{totalOnline}</span>
            <span className="text-gray-400">online</span>
          </div>
          <div className="w-px h-4 bg-white/10" />
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span><span className="text-white font-semibold">{effectiveMembers}</span> members</span>
            <span>·</span>
            <span><span className="text-gray-300 font-semibold">{onlineUsers.guests}</span> guests</span>
          </div>
        </div>
        <div className="max-w-md mx-auto relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={query} onChange={e => handleSearch(e.target.value)}
            placeholder="Search users by name..."
            className="w-full bg-[#1a1b1f] text-white pl-10 pr-4 py-3 rounded-xl border border-white/10 focus:outline-none focus:border-brand-500 transition" />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 mt-8">
        {loading
          ? <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-[#1a1b1f] rounded-xl p-4 animate-pulse border border-white/5">
                <div className="w-14 h-14 rounded-full bg-white/10 mx-auto mb-3" />
                <div className="h-3 bg-white/10 rounded w-3/4 mx-auto mb-2" />
                <div className="h-2 bg-white/5 rounded w-1/2 mx-auto" />
              </div>
            ))}
          </div>
          : results.length === 0
            ? <p className="text-gray-500 text-sm text-center py-12">No users found.</p>
            : <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {results.map(u => {
                const isOnline = effectiveOnlineIds.includes(u.uid);
                const isSelf = user?.uid === u.uid;
                return (
                  <button key={u.uid} onClick={() => navigate(`/user/${u.uid}`)}
                    className={`bg-[#1a1b1f] hover:bg-[#22232a] border rounded-xl p-4 text-center transition group relative ${isSelf ? 'border-brand-500/40' : 'border-white/5 hover:border-brand-500/40'}`}>
                    {/* Online indicator */}
                    <div className="relative w-16 mx-auto mb-3">
                      <img src={u.photoURL ?? `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u.displayName)}`}
                        alt={u.displayName} className="w-16 h-16 rounded-full object-cover border-2 border-white/10 group-hover:border-brand-500/50 transition" />
                      {isOnline && (
                        <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 bg-green-400 border-2 border-[#1a1b1f] rounded-full" />
                      )}
                    </div>
                    <div className="flex items-center justify-center gap-1.5 mb-0.5">
                      <p className="text-sm font-bold text-white truncate">{u.displayName}</p>
                      {isSelf && <span className="text-[10px] bg-brand-500/20 text-brand-400 border border-brand-500/30 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">You</span>}
                    </div>
                    {u.profile?.customTag
                      ? <span className="text-xs text-brand-400 font-medium">{u.profile.customTag}</span>
                      : <span className="text-xs text-gray-600">{isOnline ? <span className="text-green-400">Online</span> : 'Member'}</span>}
                    <div className="flex justify-center gap-3 mt-2 text-xs text-gray-500">
                      <span>{u.historyCount} watched</span>
                      <span>·</span>
                      <span>{u.watchlistCount} saved</span>
                    </div>
                  </button>
                );
              })}
            </div>}
      </div>
    </div>
  );
};

// --- Public User Profile ---

const PublicUserProfilePage = () => {
  const { uid } = useParams<{ uid: string }>();
  const { getUserPublicProfile, user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<import('./context/AuthContext').PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'history' | 'watchlist'>('history');

  useEffect(() => {
    if (!uid) return;
    getUserPublicProfile(uid).then(p => { setProfile(p); setLoading(false); });
  }, [uid]);

  if (loading) return (
    <div className="min-h-screen bg-[#202125] flex items-center justify-center">
      <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!profile) return (
    <div className="min-h-screen bg-[#202125] flex items-center justify-center text-gray-400">
      User not found.
    </div>
  );

  const banner = BANNER_PRESETS[profile.profile?.bannerIndex ?? 0];
  const joinDate = profile.profile?.joinedAt
    ? new Date(profile.profile.joinedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
    : 'Unknown';

  return (
    <div className="min-h-screen bg-[#202125] pb-24 md:pb-20">
      {/* Banner */}
      <div className="relative h-48 md:h-60 w-full" style={{ background: banner }}>
        <div className="absolute inset-0 bg-gradient-to-t from-[#202125] to-transparent" />
      </div>

      <div className="max-w-4xl mx-auto px-4 -mt-14 relative z-10">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 mb-6">
          <img src={profile.photoURL ?? `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profile.displayName)}`}
            alt={profile.displayName}
            className="w-24 h-24 rounded-full border-4 border-[#202125] object-cover shadow-2xl flex-shrink-0" />
          <div className="flex-1 min-w-0 pb-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl font-black text-white">{profile.displayName}</h1>
              {profile.profile?.customTag && (
                <span className="bg-brand-500/20 text-brand-400 border border-brand-500/30 text-xs font-bold px-2.5 py-0.5 rounded-full">
                  {profile.profile.customTag}
                </span>
              )}
            </div>
            <p className="text-gray-500 text-xs">Joined {joinDate}</p>
            {profile.profile?.bio && <p className="text-gray-300 text-sm mt-1">{profile.profile.bio}</p>}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[
            { label: 'Anime Watched', value: profile.historyCount },
            { label: 'Watchlist', value: profile.watchlistCount },
          ].map(s => (
            <div key={s.label} className="bg-[#1a1b1f] border border-white/5 rounded-xl p-4 text-center">
              <div className="text-2xl font-black text-white">{s.value}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {profile.profile?.listPrivacy === 'public' && (profile.historyData || profile.watchlistData) ? (
          <>
            {/* Tab switcher */}
            <div className="flex gap-1 mb-5 bg-[#1a1b1f] p-1 rounded-xl w-fit border border-white/5">
              {(['history', 'watchlist'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2 rounded-lg text-sm font-semibold capitalize transition ${activeTab === tab ? 'bg-brand-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                  {tab === 'history' ? `History (${profile.historyCount})` : `Watchlist (${profile.watchlistCount})`}
                </button>
              ))}
            </div>

            {activeTab === 'history' && (
              profile.historyData && profile.historyData.length > 0
                ? <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {profile.historyData.map(e => (
                    <button key={e.animeId} onClick={() => navigate(`/anime/${e.animeId}`)}
                      className="group relative rounded-xl overflow-hidden bg-[#1a1b1f] border border-white/5 hover:border-brand-500/40 transition text-left">
                      <img src={e.animeImage} alt={e.animeTitle} className="w-full aspect-[2/3] object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                        <Play className="w-8 h-8 text-white fill-white" />
                      </div>
                      <div className="p-2">
                        <p className="text-xs text-white font-semibold truncate">{e.animeTitle}</p>
                        <p className="text-[10px] text-brand-400">Ep {e.episodeNumber}</p>
                      </div>
                    </button>
                  ))}
                </div>
                : <p className="text-gray-500 text-sm text-center py-6">No watch history yet.</p>
            )}

            {activeTab === 'watchlist' && (
              profile.watchlistData && profile.watchlistData.length > 0
                ? <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {profile.watchlistData.map((anime: any) => (
                    <button key={anime.mal_id} onClick={() => navigate(`/anime/${anime.mal_id}`)}
                      className="group rounded-xl overflow-hidden bg-[#1a1b1f] border border-white/5 hover:border-brand-500/40 transition">
                      <img src={anime.images?.webp?.image_url ?? anime.images?.jpg?.image_url} alt={anime.title} className="w-full aspect-[2/3] object-cover" />
                    </button>
                  ))}
                </div>
                : <p className="text-gray-500 text-sm text-center py-6">No anime saved yet.</p>
            )}
          </>
        ) : (
          <p className="text-gray-500 text-sm text-center py-6 flex items-center justify-center gap-2">
            <Lock className="w-4 h-4" /> This user's lists are private.
          </p>
        )}
      </div>
    </div>
  );
};

// ─── Landing Page ─────────────────────────────────────────────────────────────
const LandingPage = () => {
  const navigate = useNavigate();
  const [featured, setFeatured] = useState<Anime[]>([]);

  useEffect(() => {
    jikanService.getTopAnime().then(r => setFeatured(r.data.slice(0, 6)));
  }, []);

  return (
    <div className="min-h-screen bg-[#0e0f12] flex flex-col">
      {/* Hero */}
      <div className="relative flex-1 flex flex-col items-center justify-center text-center px-4 py-24 overflow-hidden">
        {/* BG blobs — hidden on mobile to avoid GPU lag */}
        <div className="hidden sm:block absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-brand-500/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="hidden sm:block absolute bottom-1/4 right-1/4 w-[350px] h-[350px] bg-purple-500/10 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative z-10 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-xs text-gray-400 mb-8">
            <span className="w-2 h-2 rounded-full bg-green-400 sm:animate-pulse" />
            Free · No Ads · Always Updated
          </div>

          <h1 className="text-5xl sm:text-7xl font-black text-white mb-4 leading-none tracking-tight">
            Ani<span className="text-brand-500">Web</span>
          </h1>
          <p className="text-gray-400 text-lg sm:text-xl mb-10 max-w-xl mx-auto leading-relaxed">
            Watch anime and read manga in one place. Ad-free, no subscriptions, just pure entertainment. Please note this is still on early development and some features may be missing or not working properly.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => navigate('/home')}
              style={{ background: 'linear-gradient(90deg,#c73652 0%,#e94560 30%,#ff6b81 50%,#e94560 70%,#c73652 100%)', backgroundSize: '200% auto', animation: 'shimmer 2.5s linear infinite' }}
              className="flex items-center gap-2 text-white font-bold px-8 py-4 rounded-full shadow-xl shadow-brand-500/40 text-sm w-full sm:w-auto justify-center active:scale-95 hover:scale-105 transition-transform duration-200"
            >
              <PlayCircle className="w-5 h-5" /> Browse Anime
            </button>
            <button
              onClick={() => navigate('/manga')}
              style={{ background: 'linear-gradient(90deg,#6d28d9 0%,#7c3aed 30%,#a855f7 50%,#7c3aed 70%,#6d28d9 100%)', backgroundSize: '200% auto', animation: 'shimmer 2.5s linear infinite' }}
              className="flex items-center gap-2 text-white font-bold px-8 py-4 rounded-full shadow-xl shadow-purple-500/40 text-sm w-full sm:w-auto justify-center active:scale-95 hover:scale-105 transition-transform duration-200"
            >
              <BookOpen className="w-5 h-5" /> Browse Manga
            </button>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="border-t border-white/5 bg-white/2">
        <div className="max-w-4xl mx-auto px-6 py-8 grid grid-cols-3 gap-6 text-center">
          {[
            { label: 'Anime Titles', value: '10,000+' },
            { label: 'Manga Series', value: '5,000+' },
            { label: 'Always Free', value: '100%' },
          ].map(s => (
            <div key={s.label}>
              <div className="text-2xl sm:text-3xl font-black text-white">{s.value}</div>
              <div className="text-xs text-gray-500 mt-1 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Featured row */}
      {featured.length > 0 && (
        <div className="py-12 px-6 border-t border-white/5">
          <h2 className="text-center text-xs font-bold text-gray-500 uppercase tracking-[0.3em] mb-8">Trending Right Now</h2>
          <div className="flex gap-4 justify-center flex-wrap max-w-5xl mx-auto">
            {featured.map(a => (
              <button key={a.mal_id} onClick={() => navigate(`/anime/${a.mal_id}`)}
                className="group relative w-24 sm:w-28 flex-shrink-0">
                <div className="aspect-[3/4] rounded-xl overflow-hidden border border-white/5 group-hover:border-brand-500/40 transition">
                  <img src={a.images.jpg.image_url} alt={a.title} className="w-full h-full object-cover sm:group-hover:scale-105 sm:transition sm:duration-500" />
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5 line-clamp-1 group-hover:text-white transition text-center">{a.title}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="text-center py-6 text-xs text-gray-600 border-t border-white/5 flex items-center justify-center gap-3">
        <span>AniWeb Stream · Built by Jaypee</span>
        <Link to="/about" className="text-gray-500 hover:text-brand-400 transition underline underline-offset-2">About</Link>
      </div>
    </div>
  );
};

const BottomNav = () => {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();

  const go = (path: string) => {
    navigate(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#202125]/95 backdrop-blur-lg border-t border-white/5 z-[80] pb-safe pointer-events-auto">
      <div className="flex justify-around items-center h-16">
        <button onClick={() => go('/home')} className="flex flex-col items-center gap-1 text-gray-400 hover:text-brand-500 active:text-brand-500">
          <Home className="w-5 h-5" />
          <span className="text-[10px] font-medium">Home</span>
        </button>
        <button onClick={() => go('/search')} className="flex flex-col items-center gap-1 text-gray-400 hover:text-brand-500">
          <Search className="w-5 h-5" />
          <span className="text-[10px] font-medium">Search</span>
        </button>
        <button onClick={() => go('/community')} className="flex flex-col items-center gap-1 text-gray-400 hover:text-brand-500">
          <Users className="w-5 h-5" />
          <span className="text-[10px] font-medium">Community</span>
        </button>
        {isAuthenticated ? (
          <button onClick={() => go('/profile')} className="flex flex-col items-center gap-1 text-gray-400 hover:text-brand-500">
            <User className="w-5 h-5" />
            <span className="text-[10px] font-medium">Profile</span>
          </button>
        ) : (
          <button onClick={() => login()} className="flex flex-col items-center gap-1 text-gray-400 hover:text-brand-500">
            <LogIn className="w-5 h-5" />
            <span className="text-[10px] font-medium">Login</span>
          </button>
        )}
      </div>
    </div>
  );
}

// --- Main App Component ---

const AppInner = () => {
  const [lang, setLangState] = React.useState<TitleLang>(() => {
    const stored = localStorage.getItem('titleLang');
    return (stored === 'romaji' ? 'romaji' : 'english') as TitleLang;
  });
  const setLang = (l: TitleLang) => { setLangState(l); localStorage.setItem('titleLang', l); };

  return (
    <TitleLangContext.Provider value={{ lang, setLang }}>
      <HashRouter>
        <MALCallbackHandler />
        <ScrollToTop />
        <div className="bg-[#202125] min-h-screen text-white font-sans selection:bg-brand-500 selection:text-white">
          <NavBar />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/anime/:id" element={<AnimeDetailsPage />} />
            <Route path="/anime/:id/watch" element={<WatchPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/user/:uid" element={<PublicUserProfilePage />} />
            <Route path="/manga" element={<MangaPage />} />
            <Route path="/manga/search" element={<MangaSearchPage />} />
            <Route path="/manga/:id" element={<MangaDetailsPage />} />
            <Route path="/manga/:id/read/:chapterId" element={<MangaReaderPage />} />
            <Route path="/about" element={<AboutPage />} />
          </Routes>
          <BottomNav />
        </div>
      </HashRouter>
    </TitleLangContext.Provider>
  );
};

const App = () => (
  <ErrorBoundary>
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  </ErrorBoundary>
);

export default App;
