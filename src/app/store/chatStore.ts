import { create } from 'zustand';
import { getPortfolioSummary } from '@/app/actions/grok'; // Adjust path if needed

type Message = { role: 'user' | 'assistant'; content: string };
type PortfolioSummary = { totalValue: number; /* other fields */ };

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
  setWelcomeWithTotal: () => Promise<void>; // New action
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [{ role: 'assistant', content: 'Hi, I\'m Grok, your portfolio advisor. Loading your total... ask me anything!' }], // Placeholder
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
  setWelcomeWithTotal: async () => {
    try {
      const summary = await getPortfolioSummary(false); // No sandbox
      const total = summary.totalValue || 0;
      const approxTotal = Math.round(total / 100000) * 100000; // Nearest $100k for privacy
      const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(approxTotal);
      const welcomeContent = `Hi, I'm Grok, your portfolio advisor. Your current total is around ${formatted}—ask me anything! Toggle sandbox for what-if scenarios.`;
      
      set((state) => ({
        messages: state.messages.length > 0 
          ? [{ ...state.messages[0], content: welcomeContent }, ...state.messages.slice(1)]
          : [{ role: 'assistant', content: welcomeContent }]
      }));
    } catch (error) {
      // Fallback if fetch fails (e.g., offline or auth issue)
      set((state) => ({
        messages: state.messages.length > 0 
          ? [{ ...state.messages[0], content: 'Hi, I\'m Grok, your portfolio advisor. Ask me anything! Toggle sandbox for what-ifs.' }]
          : state.messages
      }));
    }
  },
}));