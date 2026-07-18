import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  RefreshCw, 
  Trash2, 
  Search, 
  MessageSquare, 
  Folder, 
  Play, 
  Database, 
  Sparkles, 
  Code, 
  AlertTriangle, 
  CheckCircle2, 
  BookOpen
} from 'lucide-react';


interface Repository {
  id: string;
  name: string;
  url: string;
  lastIndexedCommit: string | null;
  lastIndexedAt: string | null;
  createdAt: string;
}

interface SearchResult {
  id: string;
  startLine: number;
  endLine: number;
  content: string;
  chunkType: string;
  name: string;
  filePath: string;
  repoName: string;
  repoUrl: string;
  score: number;
}

interface SourceCitation {
  repoName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  chunkType: string;
  name: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceCitation[];
}

export default function App() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);
  
  // Repository form
  const [repoName, setRepoName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Chat state
  const [chatQuery, setChatQuery] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const [currentSources, setCurrentSources] = useState<SourceCitation[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const apiBase = 'http://localhost:3000';

  useEffect(() => {
    fetchRepos();
  }, []);

  useEffect(() => {
    // Scroll chat to bottom on updates
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, currentResponse]);

  const fetchRepos = async () => {
    try {
      const res = await fetch(`${apiBase}/repos`);
      const data = await res.json();
      setRepos(data);
      // Select all repos by default
      if (selectedRepoIds.length === 0 && data.length > 0) {
        setSelectedRepoIds(data.map((r: Repository) => r.id));
      }
    } catch (err) {
      console.error('Failed to fetch repositories:', err);
    }
  };

  const handleAddRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsAddingRepo(true);

    try {
      const res = await fetch(`${apiBase}/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName, url: repoPath }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to add repository');
      }

      setRepoName('');
      setRepoPath('');
      await fetchRepos();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsAddingRepo(false);
    }
  };

  const handleSyncRepo = async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/repos/${id}/sync`, { method: 'POST' });
      if (res.ok) {
        // Optimistically update lists or alert
        alert('Indexing job enqueued in background.');
        fetchRepos();
      }
    } catch (err) {
      console.error('Failed to sync repo:', err);
    }
  };

  const handleDeleteRepo = async (id: string) => {
    if (!confirm('Are you sure you want to delete this repository from CodeAtlas? This will clear its search indexes.')) return;
    try {
      const res = await fetch(`${apiBase}/repos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSelectedRepoIds(selectedRepoIds.filter(rId => rId !== id));
        fetchRepos();
      }
    } catch (err) {
      console.error('Failed to delete repo:', err);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    if (selectedRepoIds.length === 0) {
      alert('Please select at least one repository to search.');
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`${apiBase}/search?q=${encodeURIComponent(searchQuery)}&repos=${selectedRepoIds.join(',')}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const responseRef = useRef('');
  const sourcesRef = useRef<SourceCitation[]>([]);

  const handleChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuery.trim() || isGenerating) return;
    if (selectedRepoIds.length === 0) {
      alert('Please select at least one repository for AI chat.');
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: chatQuery,
    };

    setChatMessages(prev => [...prev, userMessage]);
    const activeQuery = chatQuery;
    setChatQuery('');
    setIsGenerating(true);
    setCurrentResponse('');
    setCurrentSources([]);
    responseRef.current = '';
    sourcesRef.current = [];

    // Open Server-Sent Events stream
    const url = `${apiBase}/chat?q=${encodeURIComponent(activeQuery)}&repos=${selectedRepoIds.join(',')}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.sources) {
          sourcesRef.current = data.sources;
          setCurrentSources(data.sources);
        } else if (data.chunk) {
          responseRef.current += data.chunk;
          setCurrentResponse(responseRef.current);
        } else if (data.error) {
          setCurrentResponse(prev => prev + `\n[Error: ${data.error}]`);
          eventSource.close();
          setIsGenerating(false);
        } else if (data.done) {
          eventSource.close();
          
          const finalResponse = responseRef.current;
          const finalSources = sourcesRef.current;

          // Commit stream response to main messages array using local refs to bypass stale closure
          setChatMessages(prev => [
            ...prev,
            {
              id: Date.now().toString(),
              role: 'assistant',
              content: finalResponse,
              sources: finalSources,
            }
          ]);
          setCurrentResponse('');
          setCurrentSources([]);
          responseRef.current = '';
          sourcesRef.current = [];
          setIsGenerating(false);
        }
      } catch (err) {
        console.error('Failed to parse SSE payload:', err);
      }
    };


    eventSource.onerror = (err) => {
      console.error('EventSource connection error:', err);
      eventSource.close();
      setIsGenerating(false);
    };
  };

  const toggleRepoSelection = (id: string) => {
    if (selectedRepoIds.includes(id)) {
      setSelectedRepoIds(selectedRepoIds.filter(rId => rId !== id));
    } else {
      setSelectedRepoIds([...selectedRepoIds, id]);
    }
  };

  // Helper to parse citations like [Repo/File:Lines] inside LLM message content and make them interactive links
  const renderMessageContent = (text: string) => {
    const regex = /\[([^\]]+)\/([^\]:]+):(\d+-\d+|\d+)\]/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Preamble text
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }

      const repo = match[1];
      const file = match[2];
      const lines = match[3];
      const fullCitation = `${repo}/${file}:${lines}`;

      parts.push(
        <button 
          key={match.index} 
          className="citation-link" 
          onClick={() => {
            // Fill search query or perform workspace lookups
            setSearchQuery(`file:${file}`);
            alert(`Opening reference file: ${fullCitation}`);
          }}
        >
          <Code size={10} /> {file}:{lines}
        </button>
      );

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  return (
    <div className="app-container">
      <header>
        <div className="logo-section">
          <div className="logo-icon">
            <Database size={20} color="#fff" />
          </div>
          <h1 className="logo-text">CodeAtlas</h1>
        </div>
        <div className="system-status">
          <div className="status-indicator">
            <div className="status-dot"></div>
            Local Ollama Online
          </div>
        </div>
      </header>

      <main>
        {/* Sidebar */}
        <section className="sidebar">
          <div>
            <h2 className="panel-title"><Folder size={12} /> Connected Repositories</h2>
            <form onSubmit={handleAddRepo} style={{ marginTop: '1rem' }}>
              <div className="form-group">
                <label>Repository Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. core-api" 
                  value={repoName} 
                  onChange={e => setRepoName(e.target.value)} 
                  required
                />
              </div>
              <div className="form-group">
                <label>Local Path</label>
                <input 
                  type="text" 
                  placeholder="e.g. /home/user/project" 
                  value={repoPath} 
                  onChange={e => setRepoPath(e.target.value)} 
                  required
                />
              </div>
              {errorMsg && <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginBottom: '0.75rem' }}><AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> {errorMsg}</div>}
              <button className="btn" type="submit" disabled={isAddingRepo} style={{ width: '100%' }}>
                {isAddingRepo ? <RefreshCw size={14} className="spinning" /> : <Plus size={14} />} Add Repository
              </button>
            </form>
          </div>

          <div style={{ flex: 1, marginTop: '1rem' }}>
            <h3 className="panel-title" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>Index Coverage</h3>
            <div className="repo-list">
              {repos.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem 0' }}>
                  No repositories indexed yet. Add a local folder to begin.
                </div>
              ) : (
                repos.map(repo => (
                  <div 
                    key={repo.id} 
                    className={`repo-card ${selectedRepoIds.includes(repo.id) ? 'active' : ''}`}
                    onClick={() => toggleRepoSelection(repo.id)}
                  >
                    <div className="repo-header">
                      <div className="repo-name">{repo.name}</div>
                      <div style={{ display: 'flex', gap: '0.25rem' }} onClick={e => e.stopPropagation()}>
                        <button className="btn-icon" onClick={() => handleSyncRepo(repo.id)} title="Sync Repository">
                          <RefreshCw size={12} />
                        </button>
                        <button className="btn-icon" onClick={() => handleDeleteRepo(repo.id)} title="Delete Index">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="repo-path">{repo.url}</div>
                    <div className="repo-meta">
                      <div className="sync-status">
                        {repo.lastIndexedAt ? (
                          <>
                            <CheckCircle2 size={10} color="var(--success)" /> 
                            <span>Synced {new Date(repo.lastIndexedAt).toLocaleTimeString()}</span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle size={10} color="var(--accent-purple)" />
                            <span>Never Synced</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Workspaces splits */}
        <section className="workspace">
          {/* Left Split: Semantic Search */}
          <div className="workspace-panel search-panel">
            <div className="panel-header">
              <h2 className="panel-headline"><Search size={16} color="var(--accent-indigo)" /> Semantic Code Search</h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>BM25 + pgvector Hybrid</span>
            </div>

            <form className="search-input-wrapper" onSubmit={handleSearch}>
              <input 
                type="text" 
                placeholder="Search code semantics (e.g. database transactions or auth configs)..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <button className="btn" type="submit" disabled={isSearching}>
                {isSearching ? <RefreshCw size={14} className="spinning" /> : <Play size={14} />} Search
              </button>
            </form>

            <div className="search-results-list">
              {searchResults.length === 0 && !isSearching ? (
                <div className="search-empty">
                  <BookOpen />
                  <h3>No Search Results</h3>
                  <p>Type a natural language query or exact keyword string above to locate functions across your indexed repositories.</p>
                </div>
              ) : (
                searchResults.map(result => (
                  <div key={result.id} className="result-card">
                    <div className="result-header">
                      <div className="result-file-info">
                        <span className="result-file-path">{result.filePath}</span>
                        <span className="result-repo-name">{result.repoName}</span>
                      </div>
                      <span className="result-badge">
                        Lines {result.startLine}-{result.endLine}
                      </span>
                    </div>
                    <div className="result-body">
                      <pre className="code-block">
                        <code>{result.content}</code>
                      </pre>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Split: AI Code Chat */}
          <div className="workspace-panel chat-panel">
            <div className="panel-header">
              <h2 className="panel-headline"><MessageSquare size={16} color="var(--accent-purple)" /> AI Code Assistant</h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Ollama context-grounded</span>
            </div>

            <div className="chat-history">
              {chatMessages.length === 0 && !currentResponse ? (
                <div className="search-empty">
                  <Sparkles size={48} color="var(--accent-purple)" style={{ color: 'var(--accent-purple)' }} />
                  <h3>Ask CodeAtlas</h3>
                  <p>Ask architectural questions like <i>"Where are user validation schemas?"</i> or <i>"Write a test for the payment flow"</i>.</p>
                </div>
              ) : (
                <>
                  {chatMessages.map(msg => (
                    <div key={msg.id} className={`message ${msg.role}`}>
                      <div className="message-avatar">
                        {msg.role === 'user' ? 'U' : 'AI'}
                      </div>
                      <div className="message-bubble">
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {msg.role === 'assistant' ? renderMessageContent(msg.content) : msg.content}
                        </div>
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="chat-sources">
                            <div className="sources-title">Retrieved Context:</div>
                            <div className="sources-list">
                              {msg.sources.map((src, i) => (
                                <button 
                                  key={i} 
                                  className="citation-link"
                                  onClick={() => setSearchQuery(`file:${src.filePath}`)}
                                >
                                  {src.filePath}:{src.startLine}-{src.endLine}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Streaming Response Bubble */}
                  {isGenerating && (currentResponse || currentSources.length > 0) && (
                    <div className="message assistant">
                      <div className="message-avatar">AI</div>
                      <div className="message-bubble">
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {renderMessageContent(currentResponse)}
                          {!currentResponse && <span className="spinning" style={{ display: 'inline-block' }}>⚡</span>}
                        </div>
                        {currentSources.length > 0 && (
                          <div className="chat-sources">
                            <div className="sources-title">Retrieved Context:</div>
                            <div className="sources-list">
                              {currentSources.map((src, i) => (
                                <button key={i} className="citation-link">
                                  {src.filePath}:{src.startLine}-{src.endLine}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="chat-input-area">
              <form className="chat-form" onSubmit={handleChat}>
                <input 
                  type="text" 
                  placeholder="Ask a question about the active codebases..." 
                  value={chatQuery}
                  onChange={e => setChatQuery(e.target.value)}
                  disabled={isGenerating}
                />
                <button className="btn" type="submit" disabled={isGenerating} style={{ background: 'var(--accent-purple)', boxShadow: '0 4px 15px rgba(168, 85, 247, 0.3)' }}>
                  {isGenerating ? <RefreshCw size={14} className="spinning" /> : <Sparkles size={14} />} Ask
                </button>
              </form>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
