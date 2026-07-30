"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface PracticeChoice {
  id: string;
  name: string;
}

interface PracticeContextValue {
  practices: PracticeChoice[];
  selectedPracticeId: string | null;
  selectedPracticeName: string | null;
  setSelectedPractice: (practiceId: string | null) => void;
}

const PracticeContext = createContext<PracticeContextValue | null>(null);

const STORAGE_KEY = "medicagrow.selectedPracticeId";

/** Cleared on sign-out so the next user does not inherit the selection. */
export function clearStoredPractice() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing or storage disabled — nothing to clear.
  }
}

export function PracticeProvider({
  practices,
  children,
}: {
  practices: PracticeChoice[];
  children: ReactNode;
}) {
  const [selectedPracticeId, setSelectedPracticeId] = useState<string | null>(
    null,
  );

  // Restore after mount so server and client markup match on first render.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && practices.some((practice) => practice.id === stored)) {
        setSelectedPracticeId(stored);
      } else if (stored) {
        // Stored practice is no longer accessible to this user.
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures; the selector just defaults to All Practices.
    }
  }, [practices]);

  const setSelectedPractice = useCallback((practiceId: string | null) => {
    setSelectedPracticeId(practiceId);

    try {
      if (practiceId) {
        window.localStorage.setItem(STORAGE_KEY, practiceId);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Selection still applies for this session.
    }
  }, []);

  const value = useMemo<PracticeContextValue>(
    () => ({
      practices,
      selectedPracticeId,
      selectedPracticeName:
        practices.find((practice) => practice.id === selectedPracticeId)?.name ??
        null,
      setSelectedPractice,
    }),
    [practices, selectedPracticeId, setSelectedPractice],
  );

  return (
    <PracticeContext.Provider value={value}>
      {children}
    </PracticeContext.Provider>
  );
}

export function usePractice() {
  const context = useContext(PracticeContext);

  if (!context) {
    throw new Error("usePractice must be used inside <PracticeProvider>");
  }

  return context;
}
