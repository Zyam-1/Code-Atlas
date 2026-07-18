import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

async function bootstrap() {
  dotenv.config();

  // Run raw SQL to ensure pgvector extension is created before NestJS/TypeORM initializes
  const pgClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'codeatlas',
  });

  try {
    await pgClient.connect();
    console.log('Connected to PostgreSQL database to verify/enable extensions.');
    await pgClient.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('pgvector extension ensured.');
  } catch (error) {
    console.error('Error ensuring pgvector extension:', error);
  } finally {
    await pgClient.end();
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors(); // Enable CORS for React frontend
  
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
