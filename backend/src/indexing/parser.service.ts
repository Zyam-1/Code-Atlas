import { Injectable, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import Parser from 'web-tree-sitter';

interface CodeChunk {
  startLine: number;
  endLine: number;
  content: string;
  chunkType: 'class' | 'function' | 'method' | 'general';
  name?: string;
}

@Injectable()
export class ParserService implements OnModuleInit {
  private languages: Record<string, Parser.Language> = {};
  private isInitialized = false;

  async onModuleInit() {
    await this.initializeParser();
  }

  private async initializeParser() {
    if (this.isInitialized) return;

    try {
      console.log('Initializing web-tree-sitter WASM runtime...');
      
      // Resolve path to tree-sitter.wasm
      const wasmPath = path.resolve(
        __dirname,
        '../../node_modules/web-tree-sitter/tree-sitter.wasm'
      );

      if (!fs.existsSync(wasmPath)) {
        throw new Error(`tree-sitter.wasm not found at ${wasmPath}`);
      }

      await Parser.init({
        locateFile(scriptName: string) {
          if (scriptName === 'tree-sitter.wasm') {
            return wasmPath;
          }
          return scriptName;
        },
      });

      // Load language WASMs
      const wasmsDir = path.resolve(__dirname, '../../node_modules/tree-sitter-wasms/out');
      
      const languageMap = {
        javascript: 'tree-sitter-javascript.wasm',
        typescript: 'tree-sitter-typescript.wasm',
        tsx: 'tree-sitter-tsx.wasm',
        python: 'tree-sitter-python.wasm',
        go: 'tree-sitter-go.wasm',
        java: 'tree-sitter-java.wasm',
      };

      for (const [langName, filename] of Object.entries(languageMap)) {
        const langWasmPath = path.join(wasmsDir, filename);
        if (fs.existsSync(langWasmPath)) {
          try {
            const lang = await Parser.Language.load(langWasmPath);
            this.languages[langName] = lang;
            console.log(`Loaded tree-sitter language: ${langName}`);
          } catch (err) {
            console.error(`Failed to load tree-sitter language ${langName} from ${langWasmPath}:`, err);
          }
        } else {
          console.warn(`WASM file not found for language ${langName} at ${langWasmPath}`);
        }
      }

      this.isInitialized = true;
      console.log('web-tree-sitter initialized successfully.');
    } catch (error) {
      console.error('Error initializing web-tree-sitter parser:', error);
    }
  }

  public getLanguageByExtension(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      case '.ts':
      case '.mts':
      case '.cts':
        return 'typescript';
      case '.tsx':
        return 'tsx';
      case '.py':
        return 'python';
      case '.go':
        return 'go';
      case '.java':
        return 'java';
      default:
        return null;
    }
  }

  public async chunkFile(filePath: string, content: string): Promise<CodeChunk[]> {
    if (!this.isInitialized) {
      await this.initializeParser();
    }

    const langName = this.getLanguageByExtension(filePath);
    const language = langName ? this.languages[langName] : null;

    if (!language || !content.trim()) {
      // Fallback to sliding window line chunking for unsupported languages
      return this.slidingWindowChunk(content);
    }

    try {
      const parser = new Parser();
      parser.setLanguage(language);
      const tree = parser.parse(content);
      if (!tree) {
        return this.slidingWindowChunk(content);
      }
      const chunks: CodeChunk[] = [];
      const lines = content.split('\n');

      const visit = (node: Parser.SyntaxNode) => {
        let isLogicalChunk = false;
        let chunkType: 'class' | 'function' | 'method' | 'general' = 'general';
        let name = '';

        // Node type classifications
        if (node.type === 'class_declaration' || node.type === 'class_specifier') {
          isLogicalChunk = true;
          chunkType = 'class';
          name = node.childForFieldName('name')?.text || 'AnonymousClass';
        } else if (
          node.type === 'function_declaration' ||
          node.type === 'function_definition' ||
          node.type === 'arrow_function' ||
          node.type === 'generator_function'
        ) {
          isLogicalChunk = true;
          chunkType = 'function';
          name = node.childForFieldName('name')?.text || 'anonymous';
        } else if (node.type === 'method_definition') {
          isLogicalChunk = true;
          chunkType = 'method';
          name = node.childForFieldName('name')?.text || 'anonymousMethod';
        }

        if (isLogicalChunk) {
          const startLine = node.startPosition.row + 1;
          const endLine = node.endPosition.row + 1;
          const nodeContent = lines.slice(startLine - 1, endLine).join('\n');

          // Only keep chunks that are substantial
          if (nodeContent.trim().length > 30) {
            chunks.push({
              startLine,
              endLine,
              content: nodeContent,
              chunkType,
              name,
            });
          }
        }

        // Recursively visit child nodes
        for (let i = 0; i < node.childCount; i++) {
          visit(node.child(i)!);
        }
      };

      visit(tree.rootNode);

      // If AST parsing yielded no substantial chunks, fall back to sliding window
      if (chunks.length === 0) {
        return this.slidingWindowChunk(content);
      }

      // Add a general chunk for any remaining code or imports at the top
      // Sort chunks by startLine
      chunks.sort((a, b) => a.startLine - b.startLine);
      
      const firstChunkStart = chunks[0].startLine;
      if (firstChunkStart > 3) {
        const preambleContent = lines.slice(0, firstChunkStart - 1).join('\n');
        if (preambleContent.trim().length > 20) {
          chunks.unshift({
            startLine: 1,
            endLine: firstChunkStart - 1,
            content: preambleContent,
            chunkType: 'general',
            name: 'preamble',
          });
        }
      }

      return chunks;
    } catch (error) {
      console.error(`Error parsing AST for ${filePath}, using sliding window fallback:`, error);
      return this.slidingWindowChunk(content);
    }
  }

  private slidingWindowChunk(content: string, windowSize = 40, overlap = 10): CodeChunk[] {
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    
    if (lines.length <= windowSize) {
      return [
        {
          startLine: 1,
          endLine: lines.length,
          content: content,
          chunkType: 'general',
        },
      ];
    }

    for (let i = 0; i < lines.length; i += (windowSize - overlap)) {
      const startLine = i + 1;
      const endLine = Math.min(i + windowSize, lines.length);
      const chunkContent = lines.slice(i, endLine).join('\n');

      if (chunkContent.trim().length > 10) {
        chunks.push({
          startLine,
          endLine,
          content: chunkContent,
          chunkType: 'general',
        });
      }

      if (endLine === lines.length) break;
    }

    return chunks;
  }
}
