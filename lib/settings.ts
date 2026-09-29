import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { readValue, writeValue } from './storage';

export const MIN_TALKING_MINUTES = 1;
export const MAX_TALKING_MINUTES = 5;
export const DEFAULT_TALKING_MINUTES = 1;

const TALKING_MINUTES_KEY = 'talking_minutes';

function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TALKING_MINUTES;
  return Math.min(MAX_TALKING_MINUTES, Math.max(MIN_TALKING_MINUTES, Math.round(value)));
}

interface SettingsValue {
  talkingMinutes: number;
  setTalkingMinutes: (minutes: number) => void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [talkingMinutes, setTalkingMinutesState] = useState(DEFAULT_TALKING_MINUTES);

  useEffect(() => {
    readValue(TALKING_MINUTES_KEY)
      .then((stored) => {
        if (stored !== null) setTalkingMinutesState(clampMinutes(Number(stored)));
      })
      .catch(() => {});
  }, []);

  const setTalkingMinutes = useCallback((minutes: number) => {
    const next = clampMinutes(minutes);
    setTalkingMinutesState(next);
    void writeValue(TALKING_MINUTES_KEY, String(next)).catch(() => {});
  }, []);

  return createElement(
    SettingsContext.Provider,
    { value: { talkingMinutes, setTalkingMinutes } },
    children,
  );
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used within a SettingsProvider');
  return value;
}
