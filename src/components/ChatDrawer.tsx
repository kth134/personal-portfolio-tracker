'use client';

import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useChatStore } from '@/app/store/chatStore';
import { askGrok, getPortfolioSummary } from '@/app/actions/grok';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { X, Minus, ChevronUp } from 'lucide-react';
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
  const [isMinimized, setIsMinimized] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose'
    });
  }, []);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Render Mermaid diagrams safely
  const MermaidChart = ({ code }: { code: string }) => {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (ref.current) {
        try {
          mermaid.render('mermaid-graph-' + Math.random(), code).then((result) => {
            if (ref.current && result.svg) {
              ref.current.innerHTML = result.svg;
            }
          }).catch((err) => {
            console.error('Mermaid render error:', err);
            if (ref.current) {
              ref.current.innerHTML = `<pre class="bg-muted p-4 rounded overflow-x-auto text-sm">${code}</pre>`;
            }
          });
        } catch (err) {
          console.error('Mermaid error:', err);
          if (ref.current) {
            ref.current.innerHTML = `<pre class="bg-muted p-4 rounded overflow-x-auto text-sm">${code}</pre>`;
          }
        }
      }
    }, [code]);
    return <div ref={ref} className="mermaid" />;
  };

  return (
    <>
      {/* ← NEW: modal={false} makes it floating/non-blocking */}
{isOpen && (
  <div
    className={cn(
      "fixed z-50 bg-background/95 shadow-xl overflow-hidden",
      isMinimized 
        ? "bottom-0 left-0 w-full h-12 border-t rounded-t-lg sm:left-1/2 sm:transform sm:-translate-x-1/2 sm:w-80" 
        : "inset-y-0 right-0 w-full max-w-lg h-full",
      "transform transition-all duration-300 ease-in-out",
      isOpen ? "translate-x-0" : "translate-x-full"
    )}
  >
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-4 relative">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Ask Grok</h2>
          <div className="flex items-center gap-2">
            {!isMinimized && (
              <Button variant="ghost" size="icon" onClick={() => setIsMinimized(true)}>
                <Minus className="h-4 w-4" />
              </Button>
            )}
            {isMinimized && (
              <Button variant="ghost" size="icon" onClick={() => setIsMinimized(false)}>
                <ChevronUp className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={toggleOpen}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {!isMinimized && (
          <div className="flex items-center gap-3 mt-3">
            <Switch checked={isSandbox} onCheckedChange={toggleSandbox} />
            <span className="text-sm">Sandbox Mode (What-If)</span>
            {isSandbox && (
              <Button variant="ghost" size="sm" onClick={resetSandbox}>
                Reset
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Body - Scrollable content */}
      {!isMinimized && (
        <div className="flex-1 overflow-y-auto p-4">
          {messages.map((msg, idx) => {
            let chartData = null;
            let content = msg.content;
            const jsonMatch = content.match(/\{.*\}/s);
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.chart) {
                  chartData = parsed.chart;
                  content = content.replace(jsonMatch[0], '').trim();
                }
              } catch (e) {
                console.error('Chart JSON parse error:', e);
              }
            }

            return (
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
                      {content}
                    </ReactMarkdown>
                    {chartData && (
                      <div className="mt-4">
                        <ResponsiveContainer width="100%" height={300}>
                          {chartData.type === 'line' && (
                            <LineChart data={chartData.data}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey={chartData.options?.xKey || 'name'} />
                              <YAxis />
                              <Tooltip />
                              <Legend />
                              {Array.isArray(chartData.data[0]?.data) ? (
                                chartData.data.map((line: any, i: number) => (
                                  <Line key={i} type="monotone" dataKey="value" data={line.data.map((val: number, idx: number) => ({ name: `Point ${idx + 1}`, value: val }))} stroke={`#${Math.floor(Math.random()*16777215).toString(16)}`} name={line.name} />
                                ))
                              ) : (
                                <Line type="monotone" dataKey={chartData.options?.yKey || 'value'} stroke="#8884d8" />
                              )}
                            </LineChart>
                          )}
                          {chartData.type === 'bar' && (
                            <BarChart data={chartData.data}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey={chartData.options?.xKey || 'name'} />
                              <YAxis />
                              <Tooltip />
                              <Legend />
                              <Bar dataKey={chartData.options?.yKey || 'value'} fill="#8884d8" />
                            </BarChart>
                          )}
                          {chartData.type === 'pie' && (
                            <PieChart>
                              <Pie dataKey={chartData.options?.yKey || 'value'} data={chartData.data} fill="#8884d8" label />
                              <Tooltip />
                            </PieChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {isLoading && (
            <div className="text-center text-muted-foreground text-sm">
              Grok is thinking...
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      {!isMinimized && (
        <div className="border-t p-4">
          <div className="flex gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your portfolio..."
              disabled={isLoading || (typeof window !== 'undefined' && !localStorage.getItem('grokConsent'))}
              className="flex-1 min-h-20 resize-none"
              rows={3}
            />
            <Button 
              onClick={handleSend} 
              disabled={isLoading || !input.trim() || (typeof window !== 'undefined' && !localStorage.getItem('grokConsent'))}
            >
              Send
            </Button>
          </div>
        </div>
      )}
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