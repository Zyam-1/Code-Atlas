import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { CodeFile } from './file.entity';

@Entity('repositories')
export class Repository {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  url: string; // Can be local path or git URL

  @Column({ nullable: true })
  lastIndexedCommit: string;

  @Column({ type: 'timestamp', nullable: true })
  lastIndexedAt: Date;

  @OneToMany(() => CodeFile, (file) => file.repository, { cascade: true, onDelete: 'CASCADE' })
  files: CodeFile[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
