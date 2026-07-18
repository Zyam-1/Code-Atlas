import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as DBRepository } from 'typeorm';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Repository } from '../entities/repository.entity';
import { CodeFile } from '../entities/file.entity';
import { Chunk } from '../entities/chunk.entity';
import { ParserService } from './parser.service';
import { OllamaService } from './ollama.service';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  'dist',
  'build',
  '.next',
  'out',
  'venv',
  '.venv',
  'env',
  'target',
  'coverage',
  '.gemini',
]);

const SUPPORTED_TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.go', '.java', '.c', '.cpp', '.h',
  '.html', '.css', '.json', '.yaml', '.yml',
  '.md', '.txt', '.sql', '.sh', '.xml', '.ini'
]);

@Processor('indexing')
export class IndexingProcessor extends WorkerHost {
  constructor(
    @InjectRepository(Repository)
    private readonly repoRepository: DBRepository<Repository>,
    @InjectRepository(CodeFile)
    private readonly fileRepository: DBRepository<CodeFile>,
    @InjectRepository(Chunk)
    private readonly chunkRepository: DBRepository<Chunk>,
    private readonly parserService: ParserService,
    private readonly ollamaService: OllamaService
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { repositoryId } = job.data;
    console.log(`Starting indexing job for repository ID: ${repositoryId}`);

    const repo = await this.repoRepository.findOne({
      where: { id: repositoryId },
    });


    if (!repo) {
      console.error(`Repository with ID ${repositoryId} not found.`);
      return;
    }

    console.log(`Repo object loaded in worker: ID=${repo.id}, Name=${repo.name}, URL=${repo.url}`);


    try {
      // Update repository status in database (optional metadata)
      console.log(`Scanning path: ${repo.url}`);
      if (!fs.existsSync(repo.url)) {
        throw new Error(`Path ${repo.url} does not exist on the local system.`);
      }

      // 1. Crawl all files in target folder
      const crawledFiles = this.crawlDirectory(repo.url);
      console.log(`Found ${crawledFiles.length} candidate text files in ${repo.name}`);

      // Keep track of files present in current directory to detect deletions
      const currentRelativePaths = new Set<string>();

      // 2. Index files
      for (const absolutePath of crawledFiles) {
        const relativePath = path.relative(repo.url, absolutePath);
        currentRelativePaths.add(relativePath);

        const content = fs.readFileSync(absolutePath, 'utf-8');
        const contentHash = crypto.createHash('sha1').update(content).digest('hex');

        // Check if file is already indexed and unchanged
        const existingFile = await this.fileRepository.findOne({
          where: { repositoryId: repo.id, path: relativePath },
          relations: { chunks: true },
        });

        if (existingFile && existingFile.contentHash === contentHash) {
          // File is unchanged, skip parsing & embeddings
          console.log(`Skipping unchanged file: ${relativePath}`);
          continue;
        }

        console.log(`Indexing file: ${relativePath}`);

        // If file exists but changed, delete old chunks first to overwrite
        if (existingFile) {
          await this.fileRepository.remove(existingFile);
        }

        // Parse and chunk
        const rawChunks = await this.parserService.chunkFile(relativePath, content);
        
        // Create new CodeFile record
        const newFile = new CodeFile();
        newFile.path = relativePath;
        newFile.language = path.extname(absolutePath).slice(1) || 'unknown';
        newFile.contentHash = contentHash;
        newFile.repository = repo;
        newFile.repositoryId = repo.id;
        
        const savedFile = await this.fileRepository.save(newFile);

        // Process and store chunks with embeddings
        const chunkEntities: Chunk[] = [];
        for (const rawChunk of rawChunks) {
          const chunk = new Chunk();
          chunk.startLine = rawChunk.startLine;
          chunk.endLine = rawChunk.endLine;
          chunk.content = rawChunk.content;
          chunk.chunkType = rawChunk.chunkType;
          chunk.name = rawChunk.name || null;
          chunk.file = savedFile;

          // Generate vector embedding
          chunk.embedding = await this.ollamaService.getEmbedding(rawChunk.content);
          chunkEntities.push(chunk);
        }

        if (chunkEntities.length > 0) {
          await this.chunkRepository.save(chunkEntities);
        }
      }

      // 3. Clean up deleted files from DB
      const existingDBFiles = await this.fileRepository.find({
        where: { repositoryId: repo.id },
      });

      for (const dbFile of existingDBFiles) {
        if (!currentRelativePaths.has(dbFile.path)) {
          console.log(`Cleaning up deleted file from index: ${dbFile.path}`);
          await this.fileRepository.remove(dbFile);
        }
      }

      // 4. Update repository indexed state
      repo.lastIndexedAt = new Date();
      repo.lastIndexedCommit = 'local-fs'; // local folder path runs don't require git commits
      await this.repoRepository.save(repo);

      console.log(`Successfully completed indexing repository: ${repo.name}`);
      return { status: 'success', filesIndexed: currentRelativePaths.size };
    } catch (error) {
      console.error(`Error processing repository ${repo.name}:`, error);
      throw error;
    }
  }

  private crawlDirectory(dirPath: string): string[] {
    const files: string[] = [];

    const recurse = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          recurse(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_TEXT_EXTENSIONS.has(ext)) {
            files.push(fullPath);
          }
        }
      }
    };

    recurse(dirPath);
    return files;
  }
}
