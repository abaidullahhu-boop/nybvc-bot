import * as fs from 'fs';
import {
  GenerationConfig,
  GenerativeModel,
  GoogleGenerativeAI,
} from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';

export class GeminiService {
  private readonly genAI: GoogleGenerativeAI;
  private readonly fileManager: GoogleAIFileManager;
  private readonly model: GenerativeModel;
  private readonly generationConfig: GenerationConfig;

  constructor() {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      console.warn('GOOGLE_AI_API_KEY is not set in environment variables');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.fileManager = new GoogleAIFileManager(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
    });
    this.generationConfig = {
      temperature: 0,
      topP: 0.95,
      topK: 64,
      maxOutputTokens: 8192,
      responseMimeType: 'text/plain',
    };
  }

  /**
   * Helper function to clean and parse JSON from LLM responses
   * Handles cases where JSON is wrapped in markdown code blocks
   */
  private cleanAndParseJson(text: string): any {
    // Remove markdown code blocks if present
    const jsonContent = text
      .replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1')
      .trim();

    try {
      return JSON.parse(jsonContent);
    } catch (error) {
      console.warn('Failed to parse JSON response:', error.message);
      throw error;
    }
  }

  async uploadFile(pdfPath: string) {
    const uploadResult = await this.fileManager.uploadFile(pdfPath, {
      mimeType: 'application/pdf',
      displayName: pdfPath,
    });
    const file = uploadResult.file;
    console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
    return file;
  }

  async waitForFileActive(name: string) {
    console.log('Waiting for file processing...');
    let file = await this.fileManager.getFile(name);
    while (file.state === 'PROCESSING') {
      process.stdout.write('.');
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      file = await this.fileManager.getFile(name);
    }
    if (file.state !== 'ACTIVE') {
      throw Error(`File ${file.name} failed to process`);
    }
    console.log('...file ready\n');
  }

  async deleteFile(name: string) {
    try {
      await this.fileManager.deleteFile(name);
      console.log(`File ${name} deleted successfully`);
    } catch (error) {
      console.error(`Failed to delete file ${name}: ${error.message}`);
    }
  }

  async extractContactInfoFromPdf(
    pdfPath: string,
  ): Promise<{ phoneNumber?: string; email?: string; name?: string } | null> {
    try {
      const file = await this.uploadFile(pdfPath);
      await this.waitForFileActive(file.name);

      // First, check if "POST APPROVAL AMENDMENT" is checked
      const checkboxPrompt = `Please check if the "POST APPROVAL AMENDMENT" checkbox is checked in this New York City Buildings PW1 form. 
      Look for a checkbox labeled "POST APPROVAL AMENDMENT" that might be near the top of the document.
      Please respond in JSON format with a single boolean field: {"isPostApprovalAmendmentChecked": true/false}`;

      const checkboxResult = await this.model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: checkboxPrompt },
              {
                fileData: {
                  mimeType: file.mimeType,
                  fileUri: file.uri,
                },
              },
            ],
          },
        ],
        generationConfig: this.generationConfig,
      });

      const checkboxResponse = checkboxResult.response;
      const checkboxContent = checkboxResponse.text();

      console.log(
        'Checkbox check token usage:',
        checkboxResponse.usageMetadata.totalTokenCount,
      );

      try {
        const parsedCheckboxContent = this.cleanAndParseJson(checkboxContent);
        if (parsedCheckboxContent.isPostApprovalAmendmentChecked) {
          console.log(
            'POST APPROVAL AMENDMENT checkbox is checked, skipping contact info extraction',
          );
          await this.deleteFile(file.name);
          return null;
        }
      } catch (parseError) {
        console.warn(
          'Failed to parse checkbox check response:',
          parseError.message,
        );
        await this.deleteFile(file.name);
        return null;
      }

      const prompt = `Please extract the following information from the provided text, which is from a New York City Buildings PW1 form:

1.  Property Owner's Telephone Number: Find the number listed next to "Telephone Number:" under the section related to the property owner (not the applicant or filing representative). Look for a section titled "Property Owner's Statements and Signatures".
2.  Property Owner's Email Address: Find the email address listed next to "E-Mail Address:" under the section related to the property owner (not the applicant or filing representative). Look for a section titled "Property Owner's Statements and Signatures".
3.  Property Owner's Name: Find the name of the property owner listed next to "Name (please print):" under the section related to the property owner (not the applicant or filing representative). Look for a section titled "Property Owner's Statements and Signatures".

IMPORTANT: Respond ONLY with a JSON object without any markdown formatting or code blocks. Use this exact format:
{
  "phoneNumber": "(212) 555-1234",  // Or empty string if not found
  "email": "test@example.com",      // Or empty string if not found
  "name": "John Doe"                // Or empty string if not found
}`;

      const result = await this.model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                fileData: {
                  mimeType: file.mimeType,
                  fileUri: file.uri,
                },
              },
            ],
          },
        ],
        generationConfig: this.generationConfig,
      });

      const response = result.response;
      const content = response.text();

      console.log('Total token used: ', response.usageMetadata.totalTokenCount);

      await this.deleteFile(file.name);

      try {
        const parsedContent = this.cleanAndParseJson(content);
        return {
          phoneNumber: parsedContent.phoneNumber || undefined,
          email: parsedContent.email || undefined,
          name: parsedContent.name || undefined,
        };
      } catch (parseError) {
        // If JSON parsing fails, try to extract using regex as fallback
        const phoneRegex =
          /(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const nameRegex = /Name \(please print\): (.*)/;

        const phoneNumbers = content.match(phoneRegex) || [];
        const emails = content.match(emailRegex) || [];
        const names = content.match(nameRegex) || [];

        return {
          phoneNumber:
            phoneNumbers.length > 0 ? phoneNumbers.join(', ') : undefined,
          email: emails.length > 0 ? emails.join(', ') : undefined,
          name: names.length > 0 ? names.join(', ') : undefined,
        };
      }
    } catch (error) {
      console.error(`Error extracting contact info from PDF: ${error.message}`);
      return null;
    } finally {
      // Clean up the temporary PDF file
      try {
        fs.unlinkSync(pdfPath);
      } catch (error) {
        console.warn(`Failed to delete temporary PDF file: ${error.message}`);
      }
    }
  }

  async extractAsbestosInfoFromPdf(
    pdfPath: string,
  ): Promise<{ phoneNumber?: string; email?: string; name?: string } | null> {
    try {
      const file = await this.uploadFile(pdfPath);
      await this.waitForFileActive(file.name);

      const prompt = `Extract the following fields from the corresponding section of the provided Asbestos Assessment Report document:

- Tel. # (section 6.)
- Email (section 6.)
- Contact Person (section 5.)

Those sections are near the top of the document.

IMPORTANT: Respond ONLY with a JSON object without any markdown formatting or code blocks. Use this exact format:
{
  "phoneNumber": "(212) 555-1234",  // Or empty string if not found
  "email": "test@example.com",      // Or empty string if not found 
  "name": "John Doe"                // Or empty string if not found
}`;

      const result = await this.model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                fileData: {
                  mimeType: file.mimeType,
                  fileUri: file.uri,
                },
              },
            ],
          },
        ],
        generationConfig: this.generationConfig,
      });

      const response = result.response;
      const content = response.text();

      console.log('Total token used: ', response.usageMetadata.totalTokenCount);

      await this.deleteFile(file.name);

      try {
        const parsedContent = this.cleanAndParseJson(content);
        return {
          phoneNumber: parsedContent.phoneNumber || undefined,
          email: parsedContent.email || undefined,
          name: parsedContent.name || undefined,
        };
      } catch (parseError) {
        // If JSON parsing fails, try to extract using regex as fallback
        const phoneRegex =
          /(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const nameRegex = /(.*)/;

        const phoneNumbers = content.match(phoneRegex) || [];
        const emails = content.match(emailRegex) || [];
        const names = content.match(nameRegex) || [];

        return {
          phoneNumber:
            phoneNumbers.length > 0 ? phoneNumbers.join(', ') : undefined,
          email: emails.length > 0 ? emails.join(', ') : undefined,
          name: names.length > 0 ? names.join(', ') : undefined,
        };
      }
    } catch (error) {
      console.error(`Error extracting contact info from PDF: ${error.message}`);
      return null;
    } finally {
      // Clean up the temporary PDF file
      try {
        fs.unlinkSync(pdfPath);
      } catch (error) {
        console.warn(`Failed to delete temporary PDF file: ${error.message}`);
      }
    }
  }
}
