'use client';

import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useChatStore } from '@/app/store/chatStore';
import { askGrok, getPortfolioSummary } from '@/app/actions/grok';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Mermaid from 'react-mermaid2'; // ← NEW: for rendering charts
import { X } from 'lucide-react';
import { cn } from '@/lib/utils'; // shadcn utility for className merging; add if missing

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
  const [isMounted, setIsMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (isMounted && isOpen) {
      if (typeof window !== 'undefined' && !localStorage.getItem('grokConsent')) {
        setShowConsent(true);
      }
    }
  }, [isMounted, isOpen]);

  useEffect(() => {
    if (isOpen && typeof window !== 'undefined') {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const handleConsent = () => {
    localStorage.setItem('grokConsent', 'true');
    setShowConsent(false);
    inputRef.current?.focus();
  };

  const handleSend = async () => {
    if (!input.trim() || (typeof window !== 'undefined' && !localStorage.getItem('grokConsent'))) return;
    
    const userMessage = input.trim();
    addMessage({ role: 'user', content: userMessage });
    setInput('');
    setLoading(true);

    try {
      const prevState = useChatStore.getState().sandboxState;
      const { content, changes } = await askGrok(userMessage, isSandbox, prevState);
      addMessage({ role: 'assistant', content });

      if (isSandbox && changes) {
        const newSummary = await getPortfolioSummary(true, changes);
        updateSandbox(newSummary);
      }
    } catch (error) {
      addMessage({ role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Render Mermaid diagrams safely
  const MermaidChart = ({ code }: { code: string }) => {
    try {
      return <Mermaid chart={code} />;
    } catch (err) {
      return <pre className="bg-muted p-4 rounded overflow-x-auto text-sm">{code}</pre>;
    }
  };

  return (
    <>
      {/* ← NEW: modal={false} makes it floating/non-blocking */}
{isOpen && (
  <div
    className={cn(
      "fixed inset-y-0 right-0 z-50 w-full max-w-lg h-full bg-background/95 shadow-xl overflow-hidden",
      "transform transition-transform duration-300 ease-in-out",
      isOpen ? "translate-x-0" : "translate-x-full"
    )}
  >
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-4 relative">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Ask Grok</h2>
          <Button variant="ghost" size="icon" onClick={toggleOpen}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <Switch checked={isSandbox} onCheckedChange={toggleSandbox} />
          <span className="text-sm">Sandbox Mode (What-If)</span>
          {isSandbox && (
            <Button variant="ghost" size="sm" onClick={resetSandbox}>
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Body - Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`mb-6 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
          >
            <div className="font-semibold text-sm mb-1 text-muted-foreground">
              {msg.role === 'user' ? 'You' : 'Grok'}
            </div>
            <div
              className={`
                inline-block max-w-full rounded-xl px-4 py-3 shadow-sm
                ${msg.role === 'user' 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-muted'
                }
              `}
            >
              <div className="prose prose-sm max-w-none break-words">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                    components={{
                      table: ({ children }) => (
                        <div className="overflow-x-auto -mx-4 px-4 my-3">
                          <table className="min-w-full divide-y divide-border rounded-lg overflow-hidden">
                            {children}
                          </table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
                      th: ({ children }) => (
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider">
                          {children}
                        </th>
                      ),
                      td: ({ children }) => (
                        <td className="px-3 py-2 text-sm whitespace-normal">
                          {children}
                        </td>
                      ),
                      code: ({ inline, className, children, ...props }: { inline?: boolean; className?: string; children?: React.ReactNode; [key: string]: any }) => {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeString = String(children).trim();
                        if (!inline && match && match[1] === 'mermaid') {
                          return <MermaidChart code={codeString} />;
                        }
                        return inline ? (
                          <code className="bg-black/10 rounded px-1 text-sm" {...props}>
                            {children}
                          </code>
                        ) : (
                          <pre className="bg-muted p-4 rounded overflow-x-auto text-sm">
                            <code {...props}>{children}</code>
                          </pre>
                        );
                      },
                    }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="text-center text-muted-foreground text-sm">
            Grok is thinking...
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your portfolio..."
            disabled={isLoading || (typeof window !== 'undefined' && !localStorage.getItem('grokConsent'))}
            className="flex-1"
          />
          <Button 
            onClick={handleSend} 
            disabled={isLoading || !input.trim() || (typeof window !== 'undefined' && !localStorage.getItem('grokConsent'))}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  </div>
)}
      <Dialog open={showConsent} onOpenChange={setShowConsent}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grok AI Assistant</DialogTitle>
            <DialogDescription>
              This feature sends anonymized, rounded portfolio data to xAI for contextual insights.
              No personal identifiers or exact values are shared. This is not financial advice.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConsent(false)}>Cancel</Button>
            <Button onClick={handleConsent}>I Agree</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}