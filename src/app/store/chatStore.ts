import { create } from 'zustand';

export interface Message {
  role: string;
  content: string;
}

export interface ChatState {
  messages: Message[];
  isOpen: boolean;
  isLoading: boolean;
  isSandbox: boolean;
  sandboxState: any; // Adjust type as needed
  addMessage: (message: Message) => void;
  toggleOpen: () => void;
  setLoading: (loading: boolean) => void;
  toggleSandbox: () => void;
  updateSandbox: (summary: any) => void; // Adjust type as needed
  resetSandbox: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  isLoading: false,
  isSandbox: false,
  sandboxState: null,
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setLoading: (loading) => set({ isLoading: loading }),
  toggleSandbox: () => set((state) => ({ isSandbox: !state.isSandbox })),
  updateSandbox: (summary) => set({ sandboxState: summary }),
  resetSandbox: () => set({ sandboxState: null }),
}));