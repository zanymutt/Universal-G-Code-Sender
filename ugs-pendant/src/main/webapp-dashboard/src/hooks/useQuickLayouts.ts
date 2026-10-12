import { useCallback, useState } from "react";
import {
  emptyQuickSlots,
  parseQuickSlots,
  QUICK_SLOTS_KEY,
  QuickSlot,
  QuickSlots,
} from "../utils/quickLayouts";

const read = (): QuickSlots => {
  try {
    return parseQuickSlots(JSON.parse(localStorage.getItem(QUICK_SLOTS_KEY) ?? "null"));
  } catch {
    return emptyQuickSlots();
  }
};

// The four top-bar layout slots, kept in this browser's storage.
export function useQuickLayouts() {
  const [slots, setSlots] = useState<QuickSlots>(read);

  const setSlot = useCallback((index: number, slot: QuickSlot | null) => {
    setSlots((current) => {
      const next = current.map((existing, i) => (i === index ? slot : existing));
      try {
        localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(next));
      } catch {
        // Session-only if browser storage is unavailable.
      }
      return next;
    });
  }, []);

  return { slots, setSlot };
}
