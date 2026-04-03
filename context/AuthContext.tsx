import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  ref,
  get,
  set,
  update,
  onValue,
  query,
  orderByChild,
  startAt,
  endAt,
  limitToFirst,
  onDisconnect,
  remove,
} from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage, googleProvider } from '../services/firebase';
import { Anime } from '../types';

export interface WatchHistoryEntry {
  animeId: string;
  animeTitle: string;
  animeImage: string;
  episodeId: string;
  episodeNumber: number;
  watchedAt: number;
  progress?: number;
  currentTime?: number;
  duration?: number;
}

export interface UserProfile {
  bio: string;
  customTag: string;       // admin-assigned tag
  bannerIndex: number;     // 0-7 preset banners
  displayNameLower: string; // for search
  joinedAt: number;
  listPrivacy: 'public' | 'private'; // controls public profile visibility
  customPhotoURL: string | null;     // user-uploaded profile photo
}

export interface PublicUser {
  uid: string;
  displayName: string;
  photoURL: string | null;
  profile: UserProfile;
  watchlistCount: number;
  historyCount: number;
  watchlistData?: Anime[];
  historyData?: WatchHistoryEntry[];
}

// CHANGE THIS to your own Firebase UID to get admin powers
export const ADMIN_UID = 'REPLACE_WITH_YOUR_UID';

interface AuthState {
  user: FirebaseUser | null;
  isAuthenticated: boolean;
  watchlist: Anime[];
  watchHistory: WatchHistoryEntry[];
  userProfile: UserProfile;
  isAdmin: boolean;
  onlineUsers: { members: number; guests: number };
  onlineUserIds: string[];
  login: () => Promise<void>;
  logout: () => Promise<void>;
  addToWatchlist: (anime: Anime, status?: string) => Promise<void>;
  updateWatchStatus: (id: string, status: string) => Promise<void>;
  removeFromWatchlist: (id: string) => Promise<void>;
  saveWatchHistory: (entry: WatchHistoryEntry) => Promise<void>;
  saveProgress: (animeId: string, episodeId: string, currentTime: number, duration: number, episodeNumber?: number) => Promise<void>;
  getProgress: (animeId: string, episodeId: string, episodeNumber?: number) => number;
  updateBio: (bio: string) => Promise<void>;
  updateBanner: (bannerIndex: number) => Promise<void>;
  updateListPrivacy: (privacy: 'public' | 'private') => Promise<void>;
  updateCustomPhoto: (photoURL: string) => Promise<void>;
  uploadProfilePhoto: (file: File) => Promise<string>;
  assignTagToUser: (uid: string, tag: string) => Promise<void>;
  searchUsers: (query: string) => Promise<PublicUser[]>;
  getUserPublicProfile: (uid: string) => Promise<PublicUser | null>;
}

const DEFAULT_PROFILE: UserProfile = {
  bio: '',
  customTag: '',
  bannerIndex: 0,
  displayNameLower: '',
  joinedAt: 0,
  listPrivacy: 'private',
  customPhotoURL: null,
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [watchlist, setWatchlist] = useState<Anime[]>([]);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [userProfile, setUserProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<{ members: number; guests: number }>({ members: 0, guests: 0 });
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setWatchlist([]);
        setWatchHistory([]);
        setUserProfile(DEFAULT_PROFILE);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;

    const userRef = ref(db, `users/${user.uid}`);

    const isDeveloper = user.email === 'cabahitjaypee@gmail.com';

    get(userRef).then((snap) => {
      if (!snap.exists()) {
        set(userRef, {
          displayName: user.displayName,
          email: user.email,
          photoURL: user.photoURL,
          watchlist: [],
          watchHistory: [],
          createdAt: Date.now(),
          profile: {
            bio: '',
            customTag: isDeveloper ? 'Developer' : '',
            bannerIndex: 0,
            displayNameLower: (user.displayName ?? '').toLowerCase(),
            joinedAt: Date.now(),
          },
        });
      } else {
        // Ensure profile node exists on older accounts
        const data = snap.val();
        if (!data.profile) {
          update(userRef, {
            profile: {
              bio: '',
              customTag: '',
              bannerIndex: 0,
              displayNameLower: (user.displayName ?? '').toLowerCase(),
              joinedAt: data.createdAt ?? Date.now(),
            },
          });
        }
        // Keep displayNameLower in sync
        if (data.profile?.displayNameLower !== (user.displayName ?? '').toLowerCase()) {
          update(ref(db, `users/${user.uid}/profile`), {
            displayNameLower: (user.displayName ?? '').toLowerCase(),
          });
        }
        // Ensure Developer tag is set for the owner account
        if (isDeveloper && data.profile?.customTag !== 'Developer') {
          update(ref(db, `users/${user.uid}/profile`), { customTag: 'Developer' });
        }
      }
    });

    const unsub = onValue(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setWatchlist(data.watchlist ? Object.values(data.watchlist) : []);
        const history: WatchHistoryEntry[] = data.watchHistory
          ? (Object.values(data.watchHistory) as WatchHistoryEntry[]).sort((a, b) => b.watchedAt - a.watchedAt)
          : [];
        setWatchHistory(history);

        if (data.profile) {
          setUserProfile(data.profile);
        }

        const progress: Record<string, number> = {};
        if (data.progress) {
          Object.entries(data.progress).forEach(([animeId, eps]: [string, any]) => {
            Object.entries(eps).forEach(([epKey, val]: [string, any]) => {
              progress[`${animeId}_${epKey}`] = val.currentTime ?? 0;
            });
          });
        }
        setProgressMap(progress);
      }
    });

    return () => unsub();
  }, [user]);

  useEffect(() => {
    getRedirectResult(auth).catch(() => {});
  }, []);

  // ─── Online presence tracking ────────────────────────────────────────────────
  // Writes to users/${uid}/online (user's own node) to avoid /presence permission_denied.
  useEffect(() => {
    let unsubConnected: (() => void) | null = null;
    let heartbeatInterval: any = null;

    const markOnline = () => {
      if (!user) return;
      set(ref(db, `users/${user.uid}/online`), { at: Date.now() }).catch(() => {});
    };

    if (user) {
      const connectedRef = ref(db, '.info/connected');
      unsubConnected = onValue(connectedRef, snap => {
        if (snap.val() === true) {
          markOnline();
          onDisconnect(ref(db, `users/${user.uid}/online`)).remove().catch(() => {});
        }
      });
      // Heartbeat every 2 min so presence stays fresh
      heartbeatInterval = setInterval(markOnline, 2 * 60 * 1000);
    }

    // Read all users to compute online set (active within last 5 min)
    const usersListRef = ref(db, 'users');
    const unsubUsers = onValue(usersListRef, snap => {
      if (!snap.exists()) { setOnlineUsers({ members: 0, guests: 0 }); setOnlineUserIds([]); return; }
      const cutoff = Date.now() - 5 * 60 * 1000;
      let members = 0;
      const ids: string[] = [];
      Object.entries(snap.val() as Record<string, any>).forEach(([uid, data]: [string, any]) => {
        if (data?.online?.at && data.online.at > cutoff) {
          members++;
          ids.push(uid);
        }
      });
      setOnlineUsers({ members, guests: 0 });
      setOnlineUserIds(ids);
    });

    return () => {
      if (unsubConnected) unsubConnected();
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      unsubUsers();
      if (user) remove(ref(db, `users/${user.uid}/online`)).catch(() => {});
    };
  }, [user]);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/cancelled-popup-request') {
        await signInWithRedirect(auth, googleProvider);
      }
    }
  };

  const logout = async () => { await signOut(auth); };

  // Strip undefined/null deeply so Firebase doesn't reject the write
  const sanitize = (obj: any): any => {
    if (obj === null || obj === undefined) return null;
    if (Array.isArray(obj)) return obj.map(sanitize).filter(v => v !== null);
    if (typeof obj === 'object') {
      const clean: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) clean[k] = sanitize(v);
      }
      return clean;
    }
    return obj;
  };

  const addToWatchlist = async (anime: Anime, status = 'Plan to Watch') => {
    if (!user) return;
    const normalized = sanitize({ ...anime, mal_id: String(anime.mal_id), _watchStatus: status });
    // Allow re-adding to update status
    await set(ref(db, `users/${user.uid}/watchlist/${normalized.mal_id}`), normalized);
  };

  const updateWatchStatus = async (id: string, status: string) => {
    if (!user) return;
    await update(ref(db, `users/${user.uid}/watchlist/${id}`), { _watchStatus: status });
  };

  const removeFromWatchlist = async (id: string) => {
    if (!user) return;
    await set(ref(db, `users/${user.uid}/watchlist/${id}`), null);
  };

  const saveWatchHistory = async (entry: WatchHistoryEntry) => {
    if (!user) return;
    try {
      await set(ref(db, `users/${user.uid}/watchHistory/${entry.animeId}`), entry);
    } catch (err) {
      console.error('Failed to save watch history:', err);
    }
  };

  const saveProgress = async (animeId: string, episodeId: string, currentTime: number, duration: number, episodeNumber?: number) => {
    if (!user || currentTime < 5) return;
    try {
      // Use episode number as stable key (survives scraper session changes); fall back to episodeId
      const epKey = episodeNumber != null ? `ep${episodeNumber}` : episodeId.replace(/[.#$[\]]/g, '_');
      await set(ref(db, `users/${user.uid}/progress/${animeId}/${epKey}`), {
        currentTime, duration,
        percent: duration > 0 ? Math.round((currentTime / duration) * 100) : 0,
        updatedAt: Date.now(),
      });
      await update(ref(db, `users/${user.uid}/watchHistory/${animeId}`), {
        currentTime, duration,
        progress: duration > 0 ? Math.round((currentTime / duration) * 100) : 0,
      });
    } catch { /* silent */ }
  };

  const getProgress = (animeId: string, episodeId: string, episodeNumber?: number): number => {
    const epKey = episodeNumber != null ? `ep${episodeNumber}` : episodeId.replace(/[.#$[\]]/g, '_');
    return progressMap[`${animeId}_${epKey}`] ?? 0;
  };

  const updateBio = async (bio: string) => {
    if (!user) return;
    await update(ref(db, `users/${user.uid}/profile`), { bio });
  };

  const updateBanner = async (bannerIndex: number) => {
    if (!user) return;
    await update(ref(db, `users/${user.uid}/profile`), { bannerIndex });
  };

  const updateListPrivacy = async (privacy: 'public' | 'private') => {
    if (!user) return;
    await update(ref(db, `users/${user.uid}/profile`), { listPrivacy: privacy });
  };

  const updateCustomPhoto = async (photoURL: string) => {
    if (!user) return;
    await update(ref(db, `users/${user.uid}/profile`), { customPhotoURL: photoURL });
    await update(ref(db, `users/${user.uid}`), { photoURL });
  };

  const uploadProfilePhoto = async (file: File): Promise<string> => {
    if (!user) throw new Error('Not authenticated');
    const photoRef = storageRef(storage, `profile-photos/${user.uid}`);
    await uploadBytes(photoRef, file);
    const url = await getDownloadURL(photoRef);
    await updateCustomPhoto(url);
    return url;
  };

  // Admin only: assign a custom tag to any user
  const assignTagToUser = async (uid: string, tag: string) => {
    if (!user || user.uid !== ADMIN_UID) return;
    await update(ref(db, `users/${uid}/profile`), { customTag: tag });
  };

  const searchUsers = async (searchQuery: string): Promise<PublicUser[]> => {
    if (!searchQuery.trim()) {
      // Return some users when no query
      try {
        const usersRef = query(ref(db, 'users'), limitToFirst(20));
        const snap = await get(usersRef);
        if (!snap.exists()) return [];
        return Object.entries(snap.val())
          .slice(0, 12)
          .map(([uid, data]: [string, any]) => buildPublicUser(uid, data))
          .filter(Boolean) as PublicUser[];
      } catch { return []; }
    }

    const q = searchQuery.toLowerCase();
    try {
      const usersQuery = query(
        ref(db, 'users'),
        orderByChild('profile/displayNameLower'),
        startAt(q),
        endAt(q + '\uf8ff'),
        limitToFirst(20)
      );
      const snap = await get(usersQuery);
      if (!snap.exists()) return [];
      return Object.entries(snap.val())
        .map(([uid, data]: [string, any]) => buildPublicUser(uid, data))
        .filter(Boolean) as PublicUser[];
    } catch { return []; }
  };

  const getUserPublicProfile = async (uid: string): Promise<PublicUser | null> => {
    try {
      const snap = await get(ref(db, `users/${uid}`));
      if (!snap.exists()) return null;
      return buildPublicUser(uid, snap.val());
    } catch { return null; }
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      watchlist,
      watchHistory,
      userProfile,
      isAdmin: user?.uid === ADMIN_UID,
      onlineUsers,
      onlineUserIds,
      login,
      logout,
      addToWatchlist,
      updateWatchStatus,
      removeFromWatchlist,
      saveWatchHistory,
      saveProgress,
      getProgress,
      updateBio,
      updateBanner,
      updateListPrivacy,
      updateCustomPhoto,
      uploadProfilePhoto,
      assignTagToUser,
      searchUsers,
      getUserPublicProfile,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

function buildPublicUser(uid: string, data: any): PublicUser | null {
  if (!data || !data.displayName) return null;
  const profile: UserProfile = { ...DEFAULT_PROFILE, ...(data.profile ?? {}) };
  const isPublic = profile.listPrivacy === 'public';
  return {
    uid,
    displayName: data.displayName,
    // Prefer custom uploaded photo, then Google photo
    photoURL: profile.customPhotoURL ?? data.photoURL ?? null,
    profile,
    watchlistCount: data.watchlist ? Object.keys(data.watchlist).length : 0,
    historyCount: data.watchHistory ? Object.keys(data.watchHistory).length : 0,
    // Only expose detailed list data for public profiles
    watchlistData: isPublic && data.watchlist
      ? (Object.values(data.watchlist) as Anime[]).slice(0, 24)
      : undefined,
    historyData: isPublic && data.watchHistory
      ? (Object.values(data.watchHistory) as WatchHistoryEntry[])
          .sort((a, b) => b.watchedAt - a.watchedAt)
          .slice(0, 12)
      : undefined,
  };
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
