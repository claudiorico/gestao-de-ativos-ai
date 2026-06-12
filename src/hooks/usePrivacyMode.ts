import { useState, useEffect } from 'react';

const STORAGE_KEY = 'investpro_privacy_mode';

// Module-level shared state so all hook instances stay in sync without a Context
let _value = localStorage.getItem(STORAGE_KEY) === 'true';
const _listeners = new Set<(v: boolean) => void>();

function setGlobal(v: boolean) {
  _value = v;
  localStorage.setItem(STORAGE_KEY, String(v));
  _listeners.forEach((fn) => fn(v));
}

export function usePrivacyMode() {
  const [privacyMode, setPrivacyMode] = useState(() => _value);

  useEffect(() => {
    _listeners.add(setPrivacyMode);
    return () => { _listeners.delete(setPrivacyMode); };
  }, []);

  return {
    privacyMode,
    togglePrivacyMode: () => setGlobal(!_value),
  };
}
