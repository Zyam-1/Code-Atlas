import { Injectable } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { OllamaService } from '../indexing/ollama.service';

export interface SearchResult {
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

@Injectable()
export class SearchService {
  constructor(
    @InjectEntityManager()
    private readonly entityManager: EntityManager,
    private readonly ollamaService: OllamaService
  ) {}

  /**
   * Executes a hybrid retrieval combining vector similarity search and keyword match.
   */
  async hybridSearch(query: string, repoIds: string[], limit = 10): Promise<SearchResult[]> {
    if (repoIds.length === 0) return [];

    try {
      // 1. Get query embedding vector
      const queryVector = await this.ollamaService.getEmbedding(query);
      const vectorStr = `[${queryVector.join(',')}]`;

      // 2. Perform semantic vector search
      const vectorResults = await this.entityManager.query(`
        SELECT c.id, c."startLine", c."endLine", c.content, c."chunkType", c.name,
               f.path as "filePath", r.name as "repoName", r.url as "repoUrl",
               (c.embedding <=> $1::vector) as distance
        FROM chunks c
        JOIN files f ON c."fileId" = f.id
        JOIN repositories r ON f."repositoryId" = r.id
        WHERE r.id = ANY($2::uuid[])
        ORDER BY distance ASC
        LIMIT $3
      `, [vectorStr, repoIds, limit * 2]);

      // 3. Perform exact keyword / substring search
      const keywordResults = await this.entityManager.query(`
        SELECT c.id, c."startLine", c."endLine", c.content, c."chunkType", c.name,
               f.path as "filePath", r.name as "repoName", r.url as "repoUrl",
               1.0 as distance
        FROM chunks c
        JOIN files f ON c."fileId" = f.id
        JOIN repositories r ON f."repositoryId" = r.id
        WHERE r.id = ANY($1::uuid[]) AND (c.content ILIKE $2 OR f.path ILIKE $2)
        LIMIT $3
      `, [repoIds, `%${query}%`, limit * 2]);

      // 4. Merge and re-rank results
      const mergedMap = new Map<string, SearchResult>();

      vectorResults.forEach((res: any) => {
        const distanceVal = (res.distance !== null && res.distance !== undefined && !isNaN(Number(res.distance))) ? Number(res.distance) : 2.0;
        const score = 1.0 - (distanceVal / 2.0); // convert distance to [0, 1] similarity score
        mergedMap.set(res.id, {
          id: res.id,
          startLine: res.startLine,
          endLine: res.endLine,
          content: res.content,
          chunkType: res.chunkType || 'general',
          name: res.name || '',
          filePath: res.filePath,
          repoName: res.repoName,
          repoUrl: res.repoUrl,
          score: score * 0.7, // vector weight
        });
      });


      // Process keyword results (if already present, boost score; otherwise add)
      keywordResults.forEach((res: any) => {
        const existing = mergedMap.get(res.id);
        if (existing) {
          existing.score += 0.5; // match boost
        } else {
          mergedMap.set(res.id, {
            id: res.id,
            startLine: res.startLine,
            endLine: res.endLine,
            content: res.content,
            chunkType: res.chunkType || 'general',
            name: res.name || '',
            filePath: res.filePath,
            repoName: res.repoName,
            repoUrl: res.repoUrl,
            score: 0.4, // baseline keyword weight
          });
        }
      });

      // Sort by combined score descending
      const sortedResults = Array.from(mergedMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return sortedResults;
    } catch (error) {
      console.error('Hybrid search query failure:', error);
      return [];
    }
  }
}
