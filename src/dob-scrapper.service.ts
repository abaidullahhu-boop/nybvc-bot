import {
  chromium,
  Browser,
  Page,
  ElementHandle,
  BrowserContext,
} from 'patchright';
import * as fs from 'fs';
import { GeminiService } from './gemini.service';

/**
 * Service for scraping information from NYC Department of Buildings (DOB) websites
 * Handles both BIS and DOB NOW platforms
 */
export class DobScraperService {
  private browser: Browser;
  private context: BrowserContext;

  constructor(private readonly geminiService: GeminiService) {}

  /**
   * Initializes the Chrome browser instance with specific configurations
   * Browser is launched in non-headless mode for debugging and to avoid detection
   */
  public async initializeBrowser() {
    console.log('Initializing browser...');
    this.browser = await chromium.launch({
      headless: false,
      executablePath: process.env.CHROME_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--disable-extensions',
        '--disable-default-apps',
        '--enable-features=NetworkService',
        '--window-size=1920,1080',
      ],
    });
    console.log('Browser initialized.');
  }

  /**
   * Closes the browser and cleans up resources
   */
  public async cleanup() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    console.log('Browser and context closed.');
  }

  /**
   * Creates a new page in the browser with specific configurations
   * Sets up request interception and user agent spoofing to avoid detection
   * @returns A configured Playwright Page instance
   */
  private async newPage(): Promise<Page> {
    if (!this.browser) {
      await this.initializeBrowser();
    }

    if (!this.context) {
      this.context = await this.browser.newContext({
        viewport: null,
      });
    }
    const page = await this.context.newPage();
    page.setDefaultNavigationTimeout(60000);

    return page;
  }

  /**
   * Save a quick diagnostic screenshot + first part of the HTML to logs
   */
  private async debugPage(page: Page, label: string) {
    try {
      const ts = Date.now();
      const screenshotPath = `/tmp/${label}-${ts}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Saved screenshot: ${screenshotPath}`);
      const html = await page.content();
      console.log(`Page content preview (${label}):`, html.slice(0, 2000));
    } catch (err) {
      console.warn(`Debug capture failed for ${label}: ${err.message}`);
    }
  }

  /**
   * Utility function to retry an async operation with exponential backoff
   * @param operation The async function to retry
   * @param maxRetries Maximum number of retry attempts
   * @param initialDelay Initial delay in milliseconds before first retry
   * @returns The result of the operation if successful
   * @throws The last error encountered if all retries fail
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 60000, // 1 minutes default delay
  ): Promise<T> {
    const delay = initialDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        console.log(
          `Operation failed on attempt ${attempt}/${maxRetries}: ${error.message}`,
        );

        if (attempt < maxRetries) {
          console.log(`Waiting ${delay / 60000} minutes before retrying...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error('Failed to complete operation after all retries');
  }

  /**
   * Retrieves contact information from the NYC BIS website for a given BIN
   * Searches through job filings to find phone numbers and email addresses
   * @param bin Building Identification Number
   * @returns Object containing phone number and email if found, null otherwise
   */
  async getBisContactInfo(bin: string): Promise<{
    phoneNumber?: string;
    email?: string;
    name?: string;
  } | null> {
    console.log(`Getting BIS contact info for BIN: ${bin}`);
    const page = await this.newPage();

    try {
      // Use retry mechanism for the navigation
      await this.retryOperation(async () => {
        console.log(`Navigating to BIS for BIN: ${bin}`);
        const url = `https://a810-bisweb.nyc.gov/bisweb/JobsQueryByLocationServlet?requestid=1&allbin=${bin}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle');
        console.log('Navigation successful');
      });

      const jobInfo = await this.extractJobInfo(page);
      console.log(`Found ${jobInfo.length} jobs for BIN ${bin}`);

      // Process each job until contact information is found
      for (const { jobNumber, docNumber } of jobInfo) {
        const result = await this.processVirtualJobFolder(
          bin,
          jobNumber,
          docNumber,
        );
        if (result) {
          return result;
        }
      }

      console.log(`No contact information found in any job for BIN ${bin}`);
      return null;
    } finally {
      await page.close();
    }
  }

  /**
   * Extracts job and document numbers from the BIS job listing table
   * @param page The Playwright Page instance
   * @returns Array of job and document number pairs
   */
  private async extractJobInfo(page: Page) {
    return await page.evaluate(() => {
      const rows = document.querySelectorAll('tr');
      const results = [];

      rows.forEach((row) => {
        const jobLink = row.querySelector('td:nth-child(2) a');
        const docCell = row.querySelector('td:nth-child(3)');

        if (jobLink && docCell) {
          const jobNumber = jobLink.textContent?.trim();
          const docNumber = docCell.textContent?.trim();

          if (jobNumber && docNumber) {
            results.push({ jobNumber, docNumber });
          }
        }
      });

      return results;
    });
  }

  /**
   * Processes a virtual job folder to extract contact information from PLAN/WORK APPROVAL APPLICATION
   * @param bin Building Identification Number
   * @param jobNumber Job filing number
   * @param docNumber Document number
   * @returns Object containing phone number and email if found, null otherwise
   */
  private async processVirtualJobFolder(
    bin: string,
    jobNumber: string,
    docNumber: string,
  ): Promise<{
    phoneNumber?: string;
    email?: string;
    name?: string;
  } | null> {
    console.log(
      `Processing Virtual Job Folder for Job: ${jobNumber}, Doc: ${docNumber}`,
    );
    const folderPage = await this.newPage();

    try {
      // Use retry mechanism for the navigation
      await this.retryOperation(async () => {
        const url = `https://a810-bisweb.nyc.gov/bisweb/BScanVirtualJobFolderServlet?passjobnumber=${jobNumber}&passdocnumber=${docNumber}&allbin=${bin}`;
        await folderPage.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });

        await folderPage.waitForLoadState('domcontentloaded');
        await folderPage.waitForLoadState('networkidle');
      });

      // Find the scan code for the PLAN / WORK APPROVAL APPLICATION
      const scanCode = await folderPage.evaluate(() => {
        const rows = document.querySelectorAll('tr');
        for (const row of rows) {
          const formNameCell = row.querySelector('td:first-child a');
          if (
            formNameCell?.textContent?.trim() ===
            'PLAN / WORK APPROVAL APPLICATION'
          ) {
            // Get the scan code from the last cell in the row
            const scanCodeCell = row.querySelector('td:last-child');
            return scanCodeCell?.textContent?.trim() || null;
          }
        }
        return null;
      });

      if (!scanCode) {
        console.log('No PLAN / WORK APPROVAL APPLICATION form found');
        return null;
      }

      console.log(`Found scan code: ${scanCode}`);

      // Open a new page for the document
      const documentPage = await this.newPage();
      try {
        // Use retry mechanism for the document navigation
        await this.retryOperation(async () => {
          // Navigate to the document page using the scan code
          const documentUrl = `https://a810-bisweb.nyc.gov/bisweb/BScanJobDocumentServlet?passjobnumber=${jobNumber}&passdocnumber=${docNumber}&allbin=${bin}&scancode=${scanCode}`;

          await documentPage.goto(documentUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
        });

        // Get PDF content from iframe
        const pdfPath = await this.getPdfFromIframe(documentPage);
        if (!pdfPath) {
          console.log('No PDF content found');
          return null;
        }

        const contactInfo =
          await this.geminiService.extractContactInfoFromPdf(pdfPath);
        if (!contactInfo) {
          console.log('Could not extract contact information from PDF');
          return null;
        }

        console.log('Successfully extracted contact information from PDF');
        return contactInfo;
      } finally {
        await documentPage.close();
      }
    } catch (error) {
      console.error(
        `Error processing Virtual Job Folder for Job ${jobNumber}: ${error.message}`,
      );
      return null;
    } finally {
      await folderPage.close();
    }
  }

  // Updated getPdfFromIframe function to use API request for raw PDF download
  private async getPdfFromIframe(page: Page): Promise<string | null> {
    return await this.retryOperation(async () => {
      try {
        // Wait for iframe to be present
        const iframe = await page.waitForSelector('iframe', { timeout: 60000 });
        if (!iframe) {
          console.log('No iframe found');
          return null;
        }

        // Get the iframe's src attribute
        const iframeSrc = await iframe.getAttribute('src');
        if (!iframeSrc) {
          console.log('Iframe has no src attribute');
          return null;
        }

        // Construct the full PDF URL
        const pdfUrl = `https://a810-bisweb.nyc.gov/bisweb/${iframeSrc}`;
        console.log(`Downloading PDF from ${pdfUrl}`);

        // Use Playwright's API request to directly download the PDF
        const response = await page.request.get(pdfUrl, { timeout: 60000 });
        const contentType = response.headers()['content-type'];

        if (!response.ok() || !contentType?.includes('application/pdf')) {
          console.error(
            `Failed to download PDF. Status: ${response.status()}, Content-Type: ${contentType}`,
          );
          return null;
        }

        // Get the PDF buffer
        const buffer = await response.body();

        // Generate a unique filename using the current timestamp
        const timestamp = new Date().getTime();
        const pdfPath = `temp_${timestamp}.pdf`;

        // Save the PDF file to disk
        fs.writeFileSync(pdfPath, buffer);
        console.log(`PDF downloaded successfully to ${pdfPath}`);

        return pdfPath;
      } catch (error) {
        console.error(`Error downloading PDF: ${error.message}`);
        return null;
      }
    });
  }

  /**
   * Scrapes DOB NOW website for asbestos-related documents for a given BIN
   * @param bin Building Identification Number
   * @returns Path to the downloaded PDF if found, null otherwise
   */
  async scrapeDobNow(bin: string): Promise<{
    phoneNumber?: string;
    email?: string;
    name?: string;
  } | null> {
    console.log(`Scraping DOB NOW for BIN: ${bin}`);
    const page = await this.newPage();

    try {
      console.log('Navigating to search page');
      await this.navigateToSearchPage(page);

      console.log('Searching for BIN');
      await this.searchForBin(page, bin);

      console.log('Navigating to Build Job Filings');
      await this.navigateToBuildJobFilings(page);

      console.log('Sorting by modified date');
      await this.sortByModifiedDate(page);

      console.log('Processing job rows');
      const result = await this.processJobRows(page);
      return result;
    } catch (error) {
      console.error(`Error scraping DOB NOW: ${error.message}`);
      return null;
    } finally {
      await page.close();
    }
  }

  /**
   * Navigates to the DOB NOW search page
   */
  private async navigateToSearchPage(page: Page): Promise<void> {
    await this.retryOperation(async () => {
      const searchUrl = `https://a810-dobnow.nyc.gov/publish/Index.html`;
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });

      await page.click('button[aria-label="Search by BIN"]');
      await page.waitForTimeout(1000);
    }).catch(async (err) => {
      await this.debugPage(page, 'dobnow-search');
      throw err;
    });
  }

  /**
   * Searches for a specific BIN number
   */
  private async searchForBin(page: Page, bin: string): Promise<void> {
    await this.retryOperation(async () => {
      const binInput = await page
        .locator('input[placeholder="Enter BIN"]')
        .all();
      if (binInput.length === 0) {
        throw new Error('No BIN input field found');
      }

      await binInput[1].pressSequentially(bin, { delay: 100 });
      await page.waitForTimeout(5000);

      await page
        .locator('#content')
        .getByRole('button', { name: 'Search' })
        .click();
    });
  }

  /**
   * Navigates to BUILD Job Filings section
   */
  private async navigateToBuildJobFilings(page: Page): Promise<void> {
    await this.retryOperation(async () => {
      await page.getByRole('button', { name: 'BUILD: Job Filings' }).click();
      await page.waitForTimeout(10000);
    });
  }

  /**
   * Sorts the job list by modified date
   */
  private async sortByModifiedDate(page: Page): Promise<void> {
    await this.retryOperation(async () => {
      await page.getByRole('button', { name: 'Modified Date' }).click();
      await page.waitForTimeout(2500);
      await page
        .getByRole('button', { name: 'Modified Date Sort Ascending' })
        .click();
      await page.waitForTimeout(2500);
    });
  }

  /**
   * Processes each job row and looks for asbestos documents
   * Returns the path to the downloaded PDF if found
   */
  private async processJobRows(page: Page): Promise<{
    phoneNumber?: string;
    email?: string;
    name?: string;
  } | null> {
    const rows = await page.$$('.ui-grid-canvas > .ui-grid-row');
    let dialogCount = 1;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];

      if (await this.shouldSkipRow(row)) {
        continue;
      }

      const pdfPath = await this.processJobRow(page, row, dialogCount);
      if (pdfPath) {
        return this.geminiService.extractAsbestosInfoFromPdf(pdfPath);
      }

      dialogCount++;
    }

    console.log('No asbestos documents found in any job');
    return null;
  }

  /**
   * Checks if a row should be skipped based on the sixth column content
   */
  private async shouldSkipRow(
    row: ElementHandle<SVGElement | HTMLElement>,
  ): Promise<boolean> {
    const sixthColumn = await row.$('.ui-grid-cell:nth-child(6)');
    if (sixthColumn) {
      const sixthColumnText = await sixthColumn.textContent();
      return sixthColumnText.trim() === '';
    }
    return false;
  }

  /**
   * Processes a single job row looking for asbestos documents
   */
  private async processJobRow(
    page: Page,
    row: ElementHandle<SVGElement | HTMLElement>,
    dialogCount: number,
  ): Promise<string | null> {
    return await this.retryOperation(async () => {
      const firstColumn = await row.$('.ui-grid-cell:first-child');
      if (!firstColumn) {
        console.warn('First column not found in row');
        return null;
      }

      await firstColumn.click();
      await page.waitForTimeout(5000);

      const pdfPath = await this.processDocuments(page);

      // Clean up dialog
      await page.locator(`#ngdialog${dialogCount}`).evaluate((el) => {
        el.remove();
      });

      return pdfPath;
    });
  }

  /**
   * Processes documents in the job details looking for asbestos-related PDFs
   */
  private async processDocuments(page: Page): Promise<string | null> {
    return await this.retryOperation(async () => {
      const documentsButton = await page
        .getByRole('button', { name: 'Documents' })
        .all();
      if (documentsButton.length === 0) {
        console.error('No Documents button found');
        return null;
      }

      await documentsButton[0].click();

      await page.waitForTimeout(5000);

      const dataRows = await page.$$('table.table tbody tr:not(.bg-info)');

      for (const row of dataRows) {
        const pdfPath = await this.processDocumentRow(page, row);
        if (pdfPath) {
          return pdfPath;
        }
      }

      return null;
    });
  }

  /**
   * Processes a single document row and downloads PDF if it's asbestos-related
   */
  private async processDocumentRow(
    page: Page,
    row: ElementHandle<SVGElement | HTMLElement>,
  ): Promise<string | null> {
    return await this.retryOperation(async () => {
      const documentNameCell = await row.$('td:nth-child(2)');
      if (!documentNameCell) {
        return null;
      }

      const linkElement = await documentNameCell.$('a');
      if (!linkElement) {
        return null;
      }

      const documentName = await linkElement.textContent();
      if (!documentName.toLowerCase().includes('asbestos')) {
        return null;
      }

      return this.downloadAsbestosPdf(page, linkElement);
    });
  }

  /**
   * Downloads the asbestos-related PDF document
   */
  private async downloadAsbestosPdf(
    page: Page,
    linkElement: ElementHandle<SVGElement | HTMLElement>,
  ): Promise<string | null> {
    return await this.retryOperation(async () => {
      // Augmenter les temps d'attente et ajouter des logs de débogage
      console.log('Clicking on document link...');

      const [newPage] = await Promise.all([
        this.context.waitForEvent('page', { timeout: 60000 }),
        linkElement.click(),
      ]);

      console.log('New page opened, waiting for load...');
      // Attendre plus longtemps pour le chargement de la page
      await newPage.waitForLoadState('load', { timeout: 60000 });
      await newPage.waitForLoadState('domcontentloaded', { timeout: 60000 });
      await newPage.waitForLoadState('networkidle', { timeout: 60000 });

      console.log('Page loaded, URL:', newPage.url());
      // Ajouter un délai supplémentaire pour stabiliser la page
      await newPage.waitForTimeout(5000);

      try {
        const newPageUrl = newPage.url();
        console.log('Downloading PDF from URL:', newPageUrl);

        const response = await newPage.request.get(newPageUrl, {
          timeout: 60000,
        });
        const contentType = response.headers()['content-type'];

        console.log(
          'Response status:',
          response.status(),
          'Content-Type:',
          contentType,
        );

        if (!response.ok() || !contentType?.includes('application/pdf')) {
          console.error(
            `Failed to download PDF. Status: ${response.status()}, Content-Type: ${contentType}`,
          );
          return null;
        }

        const buffer = await response.body();
        const timestamp = new Date().getTime();
        const pdfPath = `temp_${timestamp}.pdf`;

        fs.writeFileSync(pdfPath, buffer);
        console.log(`PDF downloaded successfully to ${pdfPath}`);

        return pdfPath;
      } catch (error) {
        console.error('Error downloading PDF:', error);
        // Tentative de capture d'écran pour le débogage
        try {
          await newPage.screenshot({ path: `error_${Date.now()}.png` });
          console.log('Screenshot captured for debugging');
        } catch (e) {
          console.error('Failed to capture screenshot:', e);
        }
        return null;
      } finally {
        await newPage.close();
      }
    });
  }
}
