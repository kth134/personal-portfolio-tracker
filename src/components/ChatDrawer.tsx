'use client';

import { useState, useEffect } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useChatStore } from '@/app/store/chatStore';
import { askGrok, getPortfolioSummary } from '@/app/actions/grok';

export function ChatDrawer() {
  const { 
    messages, 
    isOpen, 
    addMessage, 
    toggleOpen, 
    isLoading, 
    setLoading, 
    isSandbox, 
    toggleSandbox, 
    updateSandbox, 
    resetSandbox 
  } = useChatStore();
  
  const [input, setInput] = useState('');
  const [showConsent, setShowConsent] = useState(false);
  const [isMounted, setIsMounted] = useState(false); // ← New

  // Mount effect — runs only in browser
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Consent check — only runs after mount and when drawer opens
  useEffect(() => {
    if (isMounted && isOpen && !localStorage.getItem('grokConsent')) {
      setShowConsent(true);
    }
  }, [isMounted, isOpen]);

  const handleConsent = () => {
    localStorage.setItem('grokConsent', 'true');
    setShowConsent(false);
  };

  const handleSend = async () => {
    if (!input || !localStorage.getItem('grokConsent')) return; // Block sends until consented
    addMessage({ role: 'user', content: input });
    setLoading(true);
    try {
      const prevState = useChatStore.getState().sandboxState;
      const { content, changes } = await askGrok(input, isSandbox, prevState);
      addMessage({ role: 'assistant', content });
      if (isSandbox && changes) {
        const newSummary = await getPortfolioSummary(true, changes); // Assuming exported from actions/grok.ts
        updateSandbox(newSummary);
      }
    } catch (error) {
      addMessage({ role: 'assistant', content: 'Error: Try again.' });
    }
    setLoading(false);
    setInput('');
  };

  return (
    <>
      <Drawer open={isOpen} onOpenChange={toggleOpen}>
        <DrawerContent data-vaul-drawer-direction="right" className="w-[400px] h-full">
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
            <Button onClick={handleSend} disabled={isLoading || (isMounted && !localStorage.getItem('grokConsent'))}>Send</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <Dialog open={showConsent} onOpenChange={setShowConsent}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Consent for Grok Integration</DialogTitle>
            <DialogDescription>
              By using this feature, you agree to send anonymized portfolio summaries (no raw data or PII) to xAI for AI insights. This is for contextual advice only—not financial advice. Proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConsent(false)}>Cancel</Button>
            <Button onClick={handleConsent}>Agree</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}