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
   * Append multiple rows in a single API call and return the 1-based row index
   * of every inserted row. Avoids the 60-writes-per-minute Sheets quota that
   * one-append-per-row triggers on large BIN batches.
   *
   * Parses the start row from `updates.updatedRange` (e.g. `'05/25/2026'!A12:H101`)
   * and assigns indexes `startRow + i` for each row in order. Falls back to
   * re-reading the sheet length if parsing fails.
   */
  async appendRowsReturningIndexes(
    spreadsheetId: string,
    sheetName: string,
    rows: any[][],
  ): Promise<number[]> {
    if (rows.length === 0) {
      return [];
    }
    try {
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId,
        range: sheetName,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: rows,
        },
      });

      const updatedRange: string | undefined =
        response?.data?.updates?.updatedRange;
      if (updatedRange) {
        const match = updatedRange.match(/![A-Z]+(\d+)(?::[A-Z]+(\d+))?$/);
        if (match) {
          const startRow = parseInt(match[1], 10);
          if (!Number.isNaN(startRow)) {
            const indexes = rows.map((_, i) => startRow + i);
            console.log(
              `Appended ${rows.length} rows to ${sheetName} (rows ${startRow}-${startRow + rows.length - 1}) in spreadsheet ${spreadsheetId}`,
            );
            return indexes;
          }
        }
        console.warn(
          `Could not parse start row from updatedRange "${updatedRange}"; falling back to sheet length`,
        );
      }

      const existing = await this.getSheetData(spreadsheetId, sheetName);
      const startRow = existing.length - rows.length + 1;
      return rows.map((_, i) => startRow + i);
    } catch (error) {
      console.error(`Failed to append rows (batch): ${error.message}`);
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

  /**
   * Update many disjoint ranges in a single API call via
   * `spreadsheets.values.batchUpdate`. Each entry is `{ a1Range, values }`
   * where a1Range may be a single cell (`B12`) or a contiguous range
   * (`E12:H12`). Avoids the per-minute write quota when several updates need
   * to happen in quick succession (e.g. Phase 2 email updates for many BINs).
   */
  async batchUpdateRanges(
    spreadsheetId: string,
    sheetName: string,
    updates: { a1Range: string; values: any[][] }[],
  ): Promise<void> {
    if (updates.length === 0) {
      return;
    }
    try {
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: {
          valueInputOption: 'RAW',
          data: updates.map((u) => ({
            range: `${sheetName}!${u.a1Range}`,
            values: u.values,
          })),
        },
      });
      console.log(
        `Batch-updated ${updates.length} ranges in ${sheetName} (spreadsheet ${spreadsheetId})`,
      );
    } catch (error) {
      console.error(`Failed to batch update ranges: ${error.message}`);
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
