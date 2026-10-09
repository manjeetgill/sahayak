'use client';

import { useEffect, useState } from 'react';
import { staff } from './api';

export type WorkspaceMode = 'solo' | 'full';
const eventName = 'sahayak-workspace-mode';

export function useWorkspaceMode(clinicId?: string): WorkspaceMode {
  const [mode, setMode] = useState<WorkspaceMode>('full');
  useEffect(() => {
    if (!clinicId) return;
    let active = true;
    staff<{ workspaceMode: WorkspaceMode }>('/staff/settings')
      .then((settings) => {
        if (active) setMode(settings.workspaceMode === 'solo' ? 'solo' : 'full');
      })
      .catch(() => {});
    const changed = (event: Event) => {
      const next = (event as CustomEvent<WorkspaceMode>).detail;
      if (next === 'solo' || next === 'full') setMode(next);
    };
    window.addEventListener(eventName, changed);
    return () => {
      active = false;
      window.removeEventListener(eventName, changed);
    };
  }, [clinicId]);
  return mode;
}

export function workspaceModeChanged(mode: WorkspaceMode) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: mode }));
}
