"use client";

import React, { createContext, useContext } from "react";
import type { FarmTier } from "@/lib/tier";

const TierContext = createContext<FarmTier>("basic");

export function TierProvider({
  tier,
  children,
}: {
  tier: FarmTier;
  children: React.ReactNode;
}) {
  return <TierContext.Provider value={tier}>{children}</TierContext.Provider>;
}

export function useTier(): FarmTier {
  return useContext(TierContext);
}
