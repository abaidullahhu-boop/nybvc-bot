import { google } from 'googleapis';
import * as path from 'path';

export class GoogleSheetService {
  private readonly sheets: any;

  constructor() {
    const credentialsPath = process.env.GOOGLE_SHEET_CREDENTIALS_PATH;
    if (!credentialsPath) {
      throw new Error(
        'GOOGLE_SHEET_CREDENTIALS_PATH environment variable is not set',
      );
    }

    const auth = new google.auth.JWT({
      keyFile: path.resolve(credentialsPath),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async getSheetData(
    spreadsheetId: string,
    sheetName: string,
  ): Promise<any[][]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName,
      });

      const rows = response.data.values || [];
      console.log(
        `Read ${rows.length} rows from ${sheetName} in spreadsheet ${spreadsheetId}`,
      );
      return rows;
    } catch (error) {
      console.error(`Failed to read sheet data: ${error.message}`);
      throw error;
    }
  }

  async appendRow(spreadsheetId: string, sheetName: string, values: any[][]) {
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId,
        range: sheetName,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values,
        },
      });
      console.log(
        `Appended row to ${sheetName} in spreadsheet ${spreadsheetId}`,
      );
    } catch (error) {
      console.error(`Failed to append row: ${error.message}`);
      throw error;
    }
  }

  async sheetExists(
    spreadsheetId: string,
    sheetName: string,
  ): Promise<boolean> {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
      });

      if (response.data.sheets) {
        return response.data.sheets.some(
          (sheet) => sheet.properties?.title === sheetName,
        );
      }
      return false;
    } catch (error) {
      console.error(`Error checking if sheet exists: ${error}`);
      return false;
    }
  }

  async createSheet(spreadsheetId: string, sheetName: string): Promise<void> {
    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        },
      });
    } catch (error) {
      console.error(`Error creating sheet: ${error}`);
      throw error;
    }
  }
}
