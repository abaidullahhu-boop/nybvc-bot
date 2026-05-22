import axios, { AxiosError } from 'axios';
import { EmailExtractorService } from './email-extractor.service';

export interface SearchContext {
  name: string;
  address?: string;
  borough?: string;
  professionalTitle?: string;
}

export interface WebSearchEmailResult {
  email: string;
  sourceUrl?: string;
  searchQuery: string;
}

interface SerpOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
}

interface SerpApiResponse {
  organic_results?: SerpOrganicResult[];
  error?: string;
}

export class GoogleSearchService {
  private readonly apiKey = process.env.SERP_API_KEY?.trim();
  private readonly emailExtractor = new EmailExtractorService();
  private readonly queryDelayMs = 400;

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  buildQueries(context: SearchContext): string[] {
    const name = context.name.trim();
    const queries: string[] = [
      `"${name}" email`,
      `"${name}" contact New York`,
    ];

    if (context.borough) {
      queries.push(`"${name}" ${context.borough} email`);
    }
    if (context.address) {
      queries.push(`"${name}" "${context.address}" email`);
    }
    if (context.professionalTitle) {
      queries.push(
        `"${name}" ${context.professionalTitle} New York email`,
      );
    }
    queries.push(`"${name}" filetype:pdf`);

    return [...new Set(queries)];
  }

  async findEmail(context: SearchContext): Promise<WebSearchEmailResult | null> {
    if (!this.apiKey) {
      console.log('SERP_API_KEY not set; skipping web search email enrichment');
      return null;
    }
    if (!context.name?.trim()) {
      return null;
    }

    const queries = this.buildQueries(context);
    for (const searchQuery of queries) {
      try {
        const serp = await this.fetchSerpResults(searchQuery);
        const extracted = this.emailExtractor.extractFirstValid(serp.combinedText);
        if (extracted) {
          console.log(
            `Web search found email for "${context.name}" via query: ${searchQuery}`,
          );
          return {
            email: extracted.email,
            sourceUrl: serp.firstLink,
            searchQuery,
          };
        }
      } catch (error) {
        console.error(
          `SerpAPI search failed for query "${searchQuery}":`,
          this.formatError(error),
        );
      }
      await this.sleep(this.queryDelayMs);
    }

    console.log(
      `Web search found no email for "${context.name}" after ${queries.length} queries`,
    );
    return null;
  }

  private async fetchSerpResults(
    query: string,
  ): Promise<{ combinedText: string; firstLink?: string }> {
    const response = await axios.get<SerpApiResponse>(
      'https://serpapi.com/search.json',
      {
        params: {
          engine: 'google',
          q: query,
          api_key: this.apiKey,
          num: 10,
        },
        timeout: 30000,
      },
    );

    if (response.data.error) {
      throw new Error(response.data.error);
    }

    const results = response.data.organic_results || [];
    const parts: string[] = [];
    for (const result of results) {
      if (result.title) {
        parts.push(result.title);
      }
      if (result.snippet) {
        parts.push(result.snippet);
      }
      if (result.link) {
        parts.push(result.link);
      }
    }
    return {
      combinedText: parts.join('\n'),
      firstLink: results[0]?.link,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private formatError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.data) {
        return JSON.stringify(axiosError.response.data);
      }
      return axiosError.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
