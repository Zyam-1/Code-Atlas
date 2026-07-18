import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Repository } from './repository.entity';
import { Chunk } from './chunk.entity';

@Entity('files')
export class CodeFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  path: string; // Relative path in the repo

  @Column()
  language: string;

  @Column({ length: 40 })
  contentHash: string; // SHA1 for change detection

  @Column({ nullable: true })
  repositoryId: string | null;

  @ManyToOne(() => Repository, (repo) => repo.files, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repositoryId' })
  repository: Repository;

  @OneToMany(() => Chunk, (chunk) => chunk.file, { cascade: true, onDelete: 'CASCADE' })
  chunks: Chunk[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
