/**
 * Google User Context - Manages Google account session and profile data
 * Provides user info (name, email, photo) and persists session across reloads
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { getGoogleDriveConfig, setGoogleDriveConfig, clearGoogleDriveConfig, type GoogleDriveConfig } from '@/lib/google-drive';

export interface GoogleUserProfile {
  email: string;
  name: string | null;
  picture: string | null;
  givenName: string | null;
  familyName: string | null;
}

interface GoogleUserContextType {
  user: GoogleUserProfile | null;
  isLoading: boolean;
  isConnected: boolean;
  login: (accessToken: string, expiresIn: number) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  getUserNamespace: () => string;
}

const GoogleUserContext = createContext<GoogleUserContextType | null>(null);

const USER_PROFILE_KEY = 'investpro_google_user';

/**
 * Fetch user profile from Google API
 */
async function fetchGoogleProfile(accessToken: string): Promise<GoogleUserProfile | null> {
  try {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    if (!response.ok) {
      console.error('[GoogleUser] Failed to fetch profile:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    return {
      email: data.email,
      name: data.name || null,
      picture: data.picture || null,
      givenName: data.given_name || null,
      familyName: data.family_name || null,
    };
  } catch (error) {
    console.error('[GoogleUser] Error fetching profile:', error);
    return null;
  }
}

/**
 * Get stored user profile from localStorage
 */
function getStoredProfile(): GoogleUserProfile | null {
  try {
    const stored = sessionStorage.getItem(USER_PROFILE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

/**
 * Store user profile in sessionStorage
 */
function storeProfile(profile: GoogleUserProfile): void {
  sessionStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
}

/**
 * Clear stored user profile
 */
function clearStoredProfile(): void {
  sessionStorage.removeItem(USER_PROFILE_KEY);
}

/**
 * Generate a safe namespace from email for IndexedDB
 */
function emailToNamespace(email: string): string {
  // Create a safe, unique namespace from email
  return btoa(email.toLowerCase()).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
}

export function GoogleUserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<GoogleUserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const config = getGoogleDriveConfig();
        const storedProfile = getStoredProfile();
        
        // Check if we have a valid token
        if (config?.accessToken && config.expiresAt && config.expiresAt > Date.now()) {
          if (storedProfile) {
            // Use stored profile immediately
            setUser(storedProfile);
          }
          
          // Refresh profile in background if we have a token
          const freshProfile = await fetchGoogleProfile(config.accessToken);
          if (freshProfile) {
            setUser(freshProfile);
            storeProfile(freshProfile);
            
            // Update config with fresh email
            if (freshProfile.email !== config.userEmail) {
              setGoogleDriveConfig({
                ...config,
                userEmail: freshProfile.email,
              });
            }
          }
        } else if (storedProfile) {
          // Token expired but we have cached profile - user needs to re-auth
          setUser(storedProfile);
        }
      } catch (error) {
        console.error('[GoogleUser] Error restoring session:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    restoreSession();
  }, []);

  const login = useCallback(async (accessToken: string, expiresIn: number): Promise<void> => {
    setIsLoading(true);
    
    try {
      const profile = await fetchGoogleProfile(accessToken);
      
      if (profile) {
        setUser(profile);
        storeProfile(profile);
      }
    } catch (error) {
      console.error('[GoogleUser] Login error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    clearStoredProfile();
    clearGoogleDriveConfig();
  }, []);

  const refreshProfile = useCallback(async () => {
    const config = getGoogleDriveConfig();
    
    if (!config?.accessToken) {
      return;
    }
    
    const profile = await fetchGoogleProfile(config.accessToken);
    if (profile) {
      setUser(profile);
      storeProfile(profile);
    }
  }, []);

  const getUserNamespace = useCallback((): string => {
    if (user?.email) {
      return emailToNamespace(user.email);
    }
    
    // Fallback to stored profile or default
    const storedProfile = getStoredProfile();
    if (storedProfile?.email) {
      return emailToNamespace(storedProfile.email);
    }
    
    return 'default';
  }, [user]);

  const value: GoogleUserContextType = {
    user,
    isLoading,
    isConnected: !!user,
    login,
    logout,
    refreshProfile,
    getUserNamespace,
  };

  return (
    <GoogleUserContext.Provider value={value}>
      {children}
    </GoogleUserContext.Provider>
  );
}

export function useGoogleUser() {
  const context = useContext(GoogleUserContext);
  if (!context) {
    throw new Error('useGoogleUser must be used within GoogleUserProvider');
  }
  return context;
}

/**
 * Compatibility adapter: exposes the Google session using the same shape the app
 * consumers expect (displayName / photoURL / uid). Lets components stay agnostic
 * of the underlying provider.
 */
export function useAuthUser() {
  const { user, isConnected, isLoading, logout, getUserNamespace } = useGoogleUser();

  // uid is a primitive (string) so it keeps the memo stable across renders;
  // without memoization a new `user` object each render re-triggers consumer effects.
  const uid = getUserNamespace();

  return useMemo(
    () => ({
      user: user
        ? {
            displayName: user.name,
            photoURL: user.picture,
            email: user.email,
            uid,
          }
        : null,
      isAuthenticated: isConnected,
      isLoading,
      logout,
    }),
    [user, uid, isConnected, isLoading, logout],
  );
}
