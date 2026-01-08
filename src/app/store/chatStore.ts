import { create } from 'zustand';

interface ChatState {
  isOpen: boolean;
  toggleOpen: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  isOpen: false,
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
}));