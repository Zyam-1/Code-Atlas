import { Controller, Get, Query, Sse, MessageEvent, HttpException, HttpStatus } from '@nestjs/common';
import { SearchService, SearchResult } from './search.service';
import { OllamaService } from '../indexing/ollama.service';
import { Observable, Subject } from 'rxjs';

@Controller()
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly ollamaService: OllamaService
  ) {}

  @Get('search')
  async search(
    @Query('q') query: string,
    @Query('repos') reposStr: string,
    @Query('limit') limitStr?: string
  ) {
    if (!query) {
      throw new HttpException('Query parameter "q" is required.', HttpStatus.BAD_REQUEST);
    }
    const repoIds = reposStr ? reposStr.split(',') : [];
    const limit = limitStr ? parseInt(limitStr, 10) : 10;
    
    const results = await this.searchService.hybridSearch(query, repoIds, limit);
    return { results };
  }

  @Sse('chat')
  chat(
    @Query('q') query: string,
    @Query('repos') reposStr: string
  ): Observable<MessageEvent> {
    if (!query) {
      throw new HttpException('Query parameter "q" is required.', HttpStatus.BAD_REQUEST);
    }

    const repoIds = reposStr ? reposStr.split(',') : [];
    const subject = new Subject<MessageEvent>();

    this.executeChatStream(query, repoIds, subject);

    return subject.asObservable();
  }

  private async executeChatStream(query: string, repoIds: string[], subject: Subject<MessageEvent>) {
    try {
      // 1. Fetch relevant code context chunks
      const contextChunks = await this.searchService.hybridSearch(query, repoIds, 5);

      if (contextChunks.length === 0) {
        subject.next({
          data: {
            chunk: 'No code references found in the database. Please make sure your repositories are indexed successfully.\n',
          },
        });
        subject.next({ data: { done: true } });
        subject.complete();
        return;
      }

      // Send the citations metadata first so the client can display what files were retrieved
      const sources = contextChunks.map(chunk => ({
        repoName: chunk.repoName,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        chunkType: chunk.chunkType,
        name: chunk.name,
      }));
      subject.next({ data: { sources } });

      // 2. Build the context prompt
      let contextContent = '';
      contextChunks.forEach((chunk, index) => {
        contextContent += `\nSnippet [${index + 1}] (File: [${chunk.repoName}/${chunk.filePath}] Lines: ${chunk.startLine}-${chunk.endLine}):\n\`\`\`\n${chunk.content}\n\`\`\`\n`;
      });

      const systemPrompt = `You are CodeAtlas, an expert AI assistant that helps developers understand this codebase.
Use the provided codebase snippets below to answer the user's question accurately.
Structure your answer clearly, using markdown headers or bullet points if necessary.

CRITICAL INSTRUCTIONS:
1. Ground your answer ONLY on the provided code snippets. Do not make up or assume any functionality that is not shown in the snippets.
2. For each major detail, ALWAYS cite the file path and line numbers using the exact format: \`[RepoName/FilePath:LineNumber]\` (e.g., \`[code-atlas/src/main.ts:15-22]\`).
3. If the provided context snippets do not contain enough details to fully answer the question, state that clearly and list what is missing.

Context Code Snippets:
${contextContent}`;

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ];

      // 3. Trigger Ollama chat stream
      await this.ollamaService.chatStream(messages, (chunk: string) => {
        subject.next({ data: { chunk } });
      });

      // 4. Close the connection
      subject.next({ data: { done: true } });
      subject.complete();
    } catch (error) {
      console.error('Error during chat generation:', error);
      subject.next({ data: { error: `Chat inference failed: ${error.message}` } });
      subject.next({ data: { done: true } });
      subject.complete();
    }
  }
}
