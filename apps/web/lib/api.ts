'use client';
import { useEffect, useRef, useState } from 'react';
import type { LiveEvent } from '@sahayak/shared';

export const API =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window === 'undefined'
    ? 'http://127.0.0.1:4000'
    : `${window.location.protocol}//${window.location.hostname}:4000`);
const WS = API.replace(/^http/, 'ws');

export type User = {
  uid: string;
  clinicId: string;
  role: 'admin' | 'doctor' | 'receptionist';
  doctorId: string | null;
  name: string;
  clinicAdmin?: boolean;
};
export const roleHome = (role: User['role']) =>
  role === 'admin' ? '/admin' : role === 'doctor' ? '/doctor' : '/console';
const KEY = 'sahayak.session';
export const session = {
  get(): { token: string; user: User } | null {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      return null;
    }
  },
  set(s: { token: string; user: User }) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage blocked */
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const s = opts.auth ? session.get() : null;
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(s ? { authorization: `Bearer ${s.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && opts.auth) {
      session.clear();
      if (typeof location !== 'undefined') location.href = '/login';
    }
    throw new ApiError(res.status, j.error ?? 'error', j.message ?? res.statusText);
  }
  return j as T;
}
export const staff = <T = any>(path: string, body?: unknown, method?: 'PUT' | 'DELETE' | 'PATCH') =>
  api<T>(path, { auth: true, body, method: method ?? (body !== undefined ? 'POST' : 'GET') });

/** Live updates over WebSocket with automatic reconnect. `path` is e.g. /ws/public/slug or /ws?token=... */
export function useLive(path: string | null, onEvent: (e: LiveEvent) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!path) return;
    let ws: WebSocket | null = null,
      stop = false,
      timer: any;
    const open = () => {
      ws = new WebSocket(`${WS}${path}`);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (m) => {
        try {
          cb.current(JSON.parse(m.data));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stop) timer = setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      stop = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [path]);
  return connected;
}

export function useSession(role?: 'admin' | 'doctor' | 'receptionist') {
  const [s, setS] = useState<{ token: string; user: User } | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const cur = session.get();
    if (!cur) {
      location.href = '/login';
      return;
    }
    let active = true;
    api<User>('/me', { auth: true })
      .then((user) => {
        if (!active) return;
        const allowed =
          !role ||
          user.role === role ||
          (user.role === 'admin' && role !== 'admin') ||
          (user.role === 'doctor' && user.clinicAdmin && role !== 'doctor');
        if (!allowed) {
          location.href = roleHome(user.role);
          return;
        }
        const updated = { ...cur, user };
        session.set(updated);
        setS(updated);
        setReady(true);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) return;
        if (error instanceof ApiError && error.status === 403) {
          location.href = roleHome(cur.user.role);
          return;
        }
        const allowed =
          !role ||
          cur.user.role === role ||
          (cur.user.role === 'admin' && role !== 'admin') ||
          (cur.user.role === 'doctor' && cur.user.clinicAdmin && role !== 'doctor');
        if (!allowed) {
          location.href = roleHome(cur.user.role);
          return;
        }
        setS(cur);
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [role]);
  return ready ? s : null;
}

/** Short alarm for urgent flags (needs one prior user click in the page to be allowed by browsers). */
export function beep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.4);
      o.start(ctx.currentTime + i * 0.4);
      o.stop(ctx.currentTime + i * 0.4 + 0.25);
    }
  } catch {
    /* audio unavailable */
  }
}
