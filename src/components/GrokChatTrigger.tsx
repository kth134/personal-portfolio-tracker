'use client';

import { Button } from '@/components/ui/button';
import { useChatStore } from '@/app/store/chatStore';

export function GrokChatTrigger() {
  const toggleOpen = useChatStore((state) => state.toggleOpen);

  return (
    <Button variant="outline" onClick={toggleOpen}>
      Ask Grok
    </Button>
  );
}