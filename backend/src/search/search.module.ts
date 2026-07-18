import { Module } from '@nestjs/common';
import { IndexingModule } from '../indexing/indexing.module';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

@Module({
  imports: [IndexingModule], // Imports IndexingModule to share TypeORM repository features and OllamaService
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
