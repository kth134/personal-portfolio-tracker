'use client';

import { create } from 'zustand';
import { getPortfolioSummary } from '@/app/actions/grok'; // Adjust path if needed

// Types
type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type PortfolioSummary = {
  totalValue: number;
  allocations: Array<{ type: string; sub: string; pct: number; value: number; tickers: string[] }>;
  performance: any[];
  glidePath?: any[];
  recentTransactions: any[];
  missingPrices: string[];
  // Add other fields as needed
};

interface ChatState {
  // Core state
  messages: Message[];
  isOpen: boolean;
  isLoading: boolean;
  isSandbox: boolean;
  sandboxState: PortfolioSummary | null;

  // Actions
  addMessage: (message: Message) => void;
  clearMessages: () => void;
  toggleOpen: () => void;
  setLoading: (loading: boolean) => void;
  toggleSandbox: () => void;
  updateSandbox: (newState: PortfolioSummary) => void;
  resetSandbox: () => void;
  initializeWelcomeMessage: () => Promise<void>;
}

// Create the store
export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  messages: [], // Start empty — we'll set welcome message on first open
  isOpen: false,
  isLoading: false,
  isSandbox: false,
  sandboxState: null,

  // Actions
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  clearMessages: () =>
    set({
      messages: [],
      isSandbox: false,
      sandboxState: null,
    }),

  toggleOpen: () =>
    set((state) => {
      const newOpen = !state.isOpen;
      if (newOpen && state.messages.length === 0) {
        // First time opening → initialize welcome
        get().initializeWelcomeMessage();
      }
      return { isOpen: newOpen };
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  toggleSandbox: () =>
    set((state) => {
      const newSandbox = !state.isSandbox;
      if (newSandbox && state.sandboxState === null) {
        // Entering sandbox for first time → use current real portfolio as base
        get().initializeWelcomeMessage(); // Will also set sandboxState
      }
      return {
        isSandbox: newSandbox,
        sandboxState: newSandbox ? state.sandboxState : null,
      };
    }),

  updateSandbox: (newState) =>
    set({
      sandboxState: newState,
    }),

  resetSandbox: () =>
    set({
      isSandbox: false,
      sandboxState: null,
    }),

  // Async initializer for welcome message with rounded total
  initializeWelcomeMessage: async () => {
    const { isSandbox } = get();

    try {
      const summary = await getPortfolioSummary(isSandbox);
      const total = summary.totalValue || 0;

      // Privacy-preserving rounding: nearest $100k
      const approxTotal = Math.round(total / 100000) * 100000;
      const formatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(approxTotal);

      let welcome = `Hi, I'm Grok, your portfolio advisor. Your current total is around **${formatted}**.`;

      if (summary.missingPrices?.length > 0) {
        welcome += `\n\nNote: Missing current prices for: **${summary.missingPrices.join(', ')}**.`;
      }

      welcome += `\n\nAsk me anything about your holdings, performance, rebalancing, or glide path. Toggle **Sandbox Mode** for what-if scenarios.`;

      set({
        messages: [{ role: 'assistant', content: welcome }],
        sandboxState: isSandbox ? summary : summary, // Use real summary as sandbox base
      });
    } catch (error) {
      console.error('Failed to load portfolio summary for welcome:', error);
      const fallback = `Hi, I'm Grok, your portfolio advisor.\n\nI couldn't load your current total right now, but I'm ready to help. Ask me anything about your strategy, allocations, or what-if ideas.\n\nToggle **Sandbox Mode** to explore scenarios.`;
      set({
        messages: [{ role: 'assistant', content: fallback }],
      });
    }
  },
}));