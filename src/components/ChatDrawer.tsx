import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useChatStore } from '@/store/chatStore';
import { askGrok, getPortfolioSummary } from '@/app/actions/grok';

export function ChatDrawer() {
  const { messages, isOpen, addMessage, toggleOpen, isLoading, setLoading, isSandbox, toggleSandbox, updateSandbox, resetSandbox } = useChatStore();
  const [input, setInput] = useState('');

  const handleSend = async () => {
    if (!input) return;
    addMessage({ role: 'user', content: input });
    setLoading(true);
    try {
      const prevState = useChatStore.getState().sandboxState;
      const { content, changes } = await askGrok(input, isSandbox, prevState);
      addMessage({ role: 'assistant', content });
      if (isSandbox && changes) {
        const newSummary = await getPortfolioSummary(true, changes); // Assuming getPortfolioSummary is exported from actions/grok.ts
        updateSandbox(newSummary);
      }
    } catch (error) {
      addMessage({ role: 'assistant', content: 'Error: Try again.' });
    }
    setLoading(false);
    setInput('');
  };

  return (
    <Drawer open={isOpen} onOpenChange={toggleOpen} direction="right">
      <DrawerContent className="w-[400px] h-full">
        <DrawerHeader>
          <DrawerTitle>Ask Grok</DrawerTitle>
          <div className="flex items-center gap-2">
            <Switch checked={isSandbox} onCheckedChange={toggleSandbox} />
            <span>Sandbox Mode (What-If)</span>
            {isSandbox && <Button variant="ghost" onClick={resetSandbox}>Reset</Button>}
          </div>
        </DrawerHeader>
        <div className="p-4 overflow-y-auto flex-1">
          {messages.map((msg, i) => (
            <div key={i} className={`mb-2 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
              <span className="inline-block p-2 rounded bg-muted">{msg.content}</span>
            </div>
          ))}
          {isLoading && <div>Loading...</div>}
        </div>
        <DrawerFooter>
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your question..." />
          <Button onClick={handleSend} disabled={isLoading}>Send</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}