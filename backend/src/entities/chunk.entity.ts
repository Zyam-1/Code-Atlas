import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { CodeFile } from './file.entity';

@Entity('chunks')
export class Chunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  startLine: number;

  @Column()
  endLine: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', nullable: true })
  chunkType: string | null; // e.g. function, class, method, import, general

  @Column({ type: 'text', nullable: true })
  name: string | null; // name of class/function if resolved

  // We define vector(768) for nomic-embed-text
  @Column({ type: 'vector', length: 768, nullable: true })
  embedding: number[] | null;

  @ManyToOne(() => CodeFile, (file) => file.chunks, { onDelete: 'CASCADE' })
  file: CodeFile;

  @CreateDateColumn()
  createdAt: Date;
}
