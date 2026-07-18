import { Controller, Post, Get, Delete, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as DBRepository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import { Repository } from '../entities/repository.entity';

@Controller('repos')
export class IndexingController {
  constructor(
    @InjectRepository(Repository)
    private readonly repoRepository: DBRepository<Repository>,
    @InjectQueue('indexing')
    private readonly indexingQueue: Queue
  ) {}

  @Post()
  async addRepository(@Body('name') name: string, @Body('url') url: string) {
    if (!name || !url) {
      throw new HttpException('Repository name and url are required.', HttpStatus.BAD_REQUEST);
    }

    if (!fs.existsSync(url)) {
      throw new HttpException(`Local directory path "${url}" does not exist.`, HttpStatus.BAD_REQUEST);
    }

    // Check if repo already exists
    let repo = await this.repoRepository.findOne({ where: { url } });

    if (repo) {
      return { message: 'Repository already exists', repo };
    }

    repo = new Repository();
    repo.name = name;
    repo.url = url;

    const savedRepo = await this.repoRepository.save(repo);

    // Trigger initial indexing sync
    await this.indexingQueue.add('index-repo', { repositoryId: savedRepo.id });

    return { message: 'Repository added and sync queued', repo: savedRepo };
  }

  @Get()
  async getRepositories() {
    return this.repoRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  @Post(':id/sync')
  async syncRepository(@Param('id') id: string) {
    const repo = await this.repoRepository.findOne({ where: { id } });
    if (!repo) {
      throw new HttpException('Repository not found', HttpStatus.NOT_FOUND);
    }

    const job = await this.indexingQueue.add('index-repo', { repositoryId: repo.id });
    return { message: 'Repository sync queued', jobId: job.id };
  }

  @Delete(':id')
  async deleteRepository(@Param('id') id: string) {
    const repo = await this.repoRepository.findOne({ where: { id } });
    if (!repo) {
      throw new HttpException('Repository not found', HttpStatus.NOT_FOUND);
    }

    await this.repoRepository.remove(repo);
    return { message: 'Repository removed successfully' };
  }
}
