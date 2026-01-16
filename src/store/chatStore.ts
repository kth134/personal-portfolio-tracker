import { create } from 'zustand';
import { getPortfolioSummary } from '@/app/actions/grok';
import { refreshAssetPrices } from '@/app/dashboard/portfolio/actions';

type Message = { role: 'user' | 'assistant'; content: string };
type PortfolioSummary = { /* Define your summary type, e.g. */ totalValue: number; allocations: any[]; /* etc. */ };

interface ChatState {
  messages: Message[];
  isOpen: boolean;
  isLoading: boolean;
  isSandbox: boolean;
  sandboxState: PortfolioSummary | null;
  addMessage: (message: Message) => void;
  toggleOpen: () => void;
  setLoading: (loading: boolean) => void;
  toggleSandbox: () => void;
  updateSandbox: (newState: PortfolioSummary) => void;
  resetSandbox: () => void;
  initializeWelcomeMessage: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [{ role: 'assistant', content: 'Hi, I\'m Grok, your portfolio advisor. Ask me anything! Toggle sandbox for what-if scenarios.' }],
  isOpen: false,
  isLoading: false,
  isSandbox: false,
  sandboxState: null,
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setLoading: (loading) => set({ isLoading: loading }),
  toggleSandbox: () => set((state) => ({ isSandbox: !state.isSandbox, sandboxState: state.isSandbox ? null : state.sandboxState })),
  updateSandbox: (newState) => set({ sandboxState: newState }),
  resetSandbox: () => set({ isSandbox: false, sandboxState: null }),
  initializeWelcomeMessage: async () => {
    // Refresh prices to ensure up-to-date data
    await refreshAssetPrices();
    const summary = await getPortfolioSummary(false);
    const welcomeMessage = `Hi, I'm Grok, your portfolio advisor. Your total portfolio value is approximately $${summary.totalValue.toLocaleString()}. Ask me anything! Toggle sandbox for what-if scenarios.`;
    set({ messages: [{ role: 'assistant', content: welcomeMessage }] });
  },
}));