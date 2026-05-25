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

  /**
   * Append a single row and return its 1-based row index in the sheet so the
   * caller can later target it with updateRange. Parses the row number out of
   * the API's `updatedRange` (e.g. `'05/25/2026'!A12:H12` -> 12); falls back to
   * re-reading the sheet length if parsing fails.
   */
  async appendRowReturningIndex(
    spreadsheetId: string,
    sheetName: string,
    row: any[],
  ): Promise<number> {
    try {
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId,
        range: sheetName,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [row],
        },
      });

      const updatedRange: string | undefined = response?.data?.updates?.updatedRange;
      if (updatedRange) {
        // updatedRange looks like `'05/25/2026'!A12:H12` or `Sheet1!A12:H12`.
        const match = updatedRange.match(/![A-Z]+(\d+)(?::[A-Z]+(\d+))?$/);
        if (match) {
          const rowIndex = parseInt(match[1], 10);
          if (!Number.isNaN(rowIndex)) {
            console.log(
              `Appended row ${rowIndex} to ${sheetName} in spreadsheet ${spreadsheetId}`,
            );
            return rowIndex;
          }
        }
        console.warn(
          `Could not parse row index from updatedRange "${updatedRange}"; falling back to sheet length`,
        );
      }

      const existing = await this.getSheetData(spreadsheetId, sheetName);
      return existing.length;
    } catch (error) {
      console.error(`Failed to append row (with index): ${error.message}`);
      throw error;
    }
  }

  /**
   * Overwrite a specific A1 range (e.g. `B12` or `E12:H12`) with the provided
   * values. Used to progressively fill in per-phase data on a row that was
   * previously appended via appendRowReturningIndex.
   */
  async updateRange(
    spreadsheetId: string,
    sheetName: string,
    a1Range: string,
    values: any[][],
  ): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!${a1Range}`,
        valueInputOption: 'RAW',
        resource: {
          values,
        },
      });
      console.log(
        `Updated range ${sheetName}!${a1Range} in spreadsheet ${spreadsheetId}`,
      );
    } catch (error) {
      console.error(`Failed to update range ${a1Range}: ${error.message}`);
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
