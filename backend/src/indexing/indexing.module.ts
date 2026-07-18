import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Repository } from '../entities/repository.entity';
import { CodeFile } from '../entities/file.entity';
import { Chunk } from '../entities/chunk.entity';
import { ParserService } from './parser.service';
import { OllamaService } from './ollama.service';
import { IndexingProcessor } from './indexing.worker';
import { IndexingController } from './indexing.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Repository, CodeFile, Chunk]),
    BullModule.registerQueue({
      name: 'indexing',
    }),
  ],
  controllers: [IndexingController],
  providers: [ParserService, OllamaService, IndexingProcessor],
  exports: [ParserService, OllamaService, TypeOrmModule], // Export so SearchModule can use pgvector / database & Ollama services
})
export class IndexingModule {}
