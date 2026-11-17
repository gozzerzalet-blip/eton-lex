import { create } from 'zustand';
import type { User } from './types';
import { refreshSession, setAccessToken } from './api';
import { connectSocket, disconnectSocket } from './socket';

type AuthState = {
  user: User | null;
  ready: boolean;
  setSession: (user: User, token: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
  bootstrap: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,

  setSession: (user, token) => {
    setAccessToken(token);
    set({ user, ready: true });
    connectSocket(token);
  },

  setUser: (user) => set({ user }),

  logout: () => {
    setAccessToken(null);
    disconnectSocket();
    set({ user: null });
  },

  bootstrap: async () => {
    const data = await refreshSession();
    if (data) {
      setAccessToken(data.accessToken);
      set({ user: data.user as User, ready: true });
      connectSocket(data.accessToken);
    } else {
      set({ ready: true });
    }
  },
}));
