import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Observable } from 'rxjs';

@Injectable()
export class OllamaService {
  private readonly baseUrl: string;
  private readonly llmModel: string;
  private readonly embeddingModel: string;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('OLLAMA_URL', 'http://localhost:11434');
    // Using Qwen 2.5 Coder 3B as default for i5 CPU, fallback to 7b or user configuration
    this.llmModel = this.configService.get<string>('LLM_MODEL', 'qwen2.5-coder:3b');
    this.embeddingModel = this.configService.get<string>('EMBEDDING_MODEL', 'nomic-embed-text');
  }

  /**
   * Generates a 768-dimension vector embedding for the given text.
   */
  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/embeddings`, {
        model: this.embeddingModel,
        prompt: text,
      });

      if (!response.data || !response.data.embedding) {
        throw new Error('Invalid response structure from Ollama embeddings API');
      }

      return response.data.embedding;
    } catch (error) {
      console.error(`Ollama embedding error (Model: ${this.embeddingModel}):`, error.message);
      // Fallback for mock run if Ollama is down to prevent worker crash (vector of 768 zeros)
      // This is a safety feature during development if Ollama is not yet running
      if (process.env.NODE_ENV === 'development') {
        console.warn('Ollama offline. Generating dummy 768-dimension embedding for testing.');
        return new Array(768).fill(0);
      }
      throw new HttpException(
        `Failed to generate embedding: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Triggers a chat completion with Ollama. Supports streaming.
   */
  async chatStream(
    messages: Array<{ role: string; content: string }>,
    onChunk: (content: string) => void
  ): Promise<void> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/chat`,
        {
          model: this.llmModel,
          messages,
          stream: true,
          options: {
            temperature: 0.2, // low temperature for high factual accuracy
          },
        },
        { responseType: 'stream' }
      );

      return new Promise((resolve, reject) => {
        response.data.on('data', (buffer: Buffer) => {
          const lines = buffer.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.message?.content) {
                  onChunk(parsed.message.content);
                }
                if (parsed.done) {
                  resolve();
                }
              } catch (e) {
                // Ignore incomplete JSON chunks in buffer stream boundary
              }
            }
          }
        });

        response.data.on('end', () => resolve());
        response.data.on('error', (err: Error) => reject(err));
      });
    } catch (error) {
      console.error(`Ollama chat completion error (Model: ${this.llmModel}):`, error.message);
      if (process.env.NODE_ENV === 'development') {
        console.warn('Ollama offline. Streaming a mock AI response for testing.');
        // Generate a nice mock streaming response detailing the code search context
        const userQuery = messages.find(m => m.role === 'user')?.content || '';
        
        let responseText = `🤖 **Ollama is Offline** (using development fallback mode).
I've received your query: "${userQuery}".

To answer this query, I retrieved code references from your database. In a fully configured system, this text would be sent to the local **${this.llmModel}** model for synthesis.

Here is a mock analysis of the context:
1. The codebase search successfully fetched matches corresponding to your query.
2. The retrieved snippet context describes the relevant logic.
3. You can click on the retrieved context citation links to inspect the parsed lines.

To enable live local AI completions, run:
\`\`\`bash
ollama run ${this.llmModel}
\`\`\`
on your local host machine.
`;
        
        // Stream it in chunks of characters to mock a typing effect
        const chunkSize = 15;
        for (let i = 0; i < responseText.length; i += chunkSize) {
          onChunk(responseText.substring(i, i + chunkSize));
          await new Promise(r => setTimeout(r, 40));
        }
        return;
      }
      throw new HttpException(
        `Failed to call Ollama chat: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
