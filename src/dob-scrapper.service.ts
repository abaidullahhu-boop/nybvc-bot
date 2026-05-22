import {
  chromium,
  Browser,
  Page,
  ElementHandle,
  BrowserContext,
  Response,
} from 'patchright';
import * as fs from 'fs';
import { GeminiService } from './gemini.service';
import {
  ContactExtractionOutcome,
  DiagnosticNote,
  hasAnyContact,
  hasFullContact,
  mergeContact,
} from './contact-extraction.types';

type BisSectionContact = {
  name?: string;
  phoneNumber?: string;
  email?: string;
};

type BisApplicationDetails = {
  owner?: BisSectionContact;
  applicant?: BisSectionContact;
};

type VirtualFolderResult = {
  contact: ContactExtractionOutcome['contact'];
  notes: DiagnosticNote[];
  screenshotPath?: string;
  deniedUrl?: string;
  lastAttemptedUrl?: string;
  applicantPhoneNumber?: string;
};

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
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
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
    await this.debugPageReturnPath(page, label);
  }

  private async debugPageReturnPath(
    page: Page,
    label: string,
  ): Promise<string | undefined> {
    try {
      const ts = Date.now();
      const screenshotPath = `/tmp/${label}-${ts}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Saved screenshot: ${screenshotPath}`);
      const html = await page.content();
      console.log(`Page content preview (${label}):`, html.slice(0, 2000));
      return screenshotPath;
    } catch (err) {
      console.warn(`Debug capture failed for ${label}: ${err.message}`);
      return undefined;
    }
  }

  /**
   * Owner and applicant blocks from BIS Application Details HTML — no PDF required.
   */
  private async extractBisApplicationDetails(
    jobNumber: string,
    docNumber: string,
  ): Promise<BisApplicationDetails | null> {
    const page = await this.newPage();
    try {
      const url = `https://a810-bisweb.nyc.gov/bisweb/JobsQueryByNumberServlet?requestid=2&passjobnumber=${jobNumber}&passdocnumber=${docNumber}`;
      await this.retryOperation(async () => {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
        await page.waitForLoadState('networkidle').catch(() => {});
      });

      const sections = await page.evaluate(() => {
        const bodyText = document.body?.innerText || '';

        const parseSection = (sectionText: string) => {
          if (/not applicable/i.test(sectionText)) {
            return null;
          }
          const name = sectionText.match(/\bName:\s*([^\n]+)/i)?.[1]?.trim();
          const phone = sectionText
            .match(/\bBusiness Phone:\s*([^\n]+)/i)?.[1]
            ?.trim();
          const email = sectionText.match(/\bE-Mail:\s*([^\n]+)/i)?.[1]?.trim();
          if (!name && !phone && !email) {
            return null;
          }
          return {
            name: name || undefined,
            phoneNumber: phone || undefined,
            email: email || undefined,
          };
        };

        const ownerMatch = bodyText.match(
          /26\s+Owner'?s?\s+Information[\s\S]*?(?=\n\d+\s+[A-Z]|\nIf you have any questions|$)/i,
        );
        const applicantMatch = bodyText.match(
          /2\s+Applicant of Record Information[\s\S]*?(?=\n3\s+Filing Representative|$)/i,
        );
        return {
          owner: ownerMatch ? parseSection(ownerMatch[0]) : null,
          applicant: applicantMatch ? parseSection(applicantMatch[0]) : null,
        };
      });

      const result: BisApplicationDetails = {};
      if (sections.owner) {
        result.owner = sections.owner;
      }
      if (sections.applicant) {
        result.applicant = sections.applicant;
      }
      if (result.owner || result.applicant) {
        console.log(
          `Application Details job ${jobNumber} doc ${docNumber}: owner phone=${result.owner?.phoneNumber || '(none)'}, applicant phone=${result.applicant?.phoneNumber || '(none)'}`,
        );
        return result;
      }
      return null;
    } catch (error) {
      console.warn(
        `Application Details scrape failed for job ${jobNumber}: ${error.message}`,
      );
      return null;
    } finally {
      await page.close();
    }
  }

  /** Owner fields for contact merge; applicant phone kept separate for sheet column. */
  private contactsFromAppDetails(
    appDetails: BisApplicationDetails | null,
  ): {
    contact: ContactExtractionOutcome['contact'];
    applicantPhoneNumber?: string;
  } {
    if (!appDetails) {
      return { contact: {} };
    }
    const owner = appDetails.owner;
    const applicant = appDetails.applicant;
    return {
      contact: {
        name: owner?.name || applicant?.name,
        phoneNumber: owner?.phoneNumber,
        email: owner?.email || applicant?.email,
      },
      applicantPhoneNumber: applicant?.phoneNumber?.trim() || undefined,
    };
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
  async getBisContactInfo(bin: string): Promise<ContactExtractionOutcome> {
    console.log(`Getting BIS contact info for BIN: ${bin}`);
    const page = await this.newPage();
    const notes: DiagnosticNote[] = [];
    let lastDeniedUrl: string | undefined;
    let lastAttemptedUrl: string | undefined;
    let lastScreenshot: string | undefined;
    let bestContact: ContactExtractionOutcome['contact'] = {};
    let bestApplicantPhone: string | undefined;

    try {
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

      if (jobInfo.length === 0) {
        notes.push({
          stage: 'BIS',
          code: 'BIS_NO_JOBS',
          detail: 'no rows in BIS job table',
        });
        lastScreenshot = await this.debugPageReturnPath(page, 'bis-no-jobs');
        return {
          contact: bestContact,
          notes,
          screenshotPath: lastScreenshot,
          deniedUrl: lastDeniedUrl,
          lastAttemptedUrl,
          applicantPhoneNumber: bestApplicantPhone,
        };
      }

      for (const { jobNumber, docNumber } of jobInfo) {
        const folderResult = await this.processVirtualJobFolder(
          bin,
          jobNumber,
          docNumber,
        );
        notes.push(...folderResult.notes);
        if (folderResult.lastAttemptedUrl) {
          lastAttemptedUrl = folderResult.lastAttemptedUrl;
        }
        if (folderResult.deniedUrl) {
          lastDeniedUrl = folderResult.deniedUrl;
        }
        if (folderResult.screenshotPath) {
          lastScreenshot = folderResult.screenshotPath;
        }
        bestContact = mergeContact(bestContact, folderResult.contact);
        if (folderResult.applicantPhoneNumber?.trim()) {
          bestApplicantPhone = folderResult.applicantPhoneNumber.trim();
        }

        // Stop early when email, owner phone, and name are all present from BIS.
        if (hasFullContact(bestContact)) {
          return {
            contact: bestContact,
            notes: [],
            screenshotPath: undefined,
            deniedUrl: lastDeniedUrl,
            lastAttemptedUrl,
            applicantPhoneNumber: bestApplicantPhone,
          };
        }
      }

      console.log(`No contact information found in any job for BIN ${bin}`);
      return {
        contact: bestContact,
        notes,
        screenshotPath: lastScreenshot,
        deniedUrl: lastDeniedUrl,
        lastAttemptedUrl,
        applicantPhoneNumber: bestApplicantPhone,
      };
    } catch (error) {
      notes.push({
        stage: 'BIS',
        code: 'BIS_NAV_FAILED',
        detail: error.message?.slice(0, 200) || 'BIS navigation failed',
      });
      lastScreenshot =
        (await this.debugPageReturnPath(page, 'bis-error')) || lastScreenshot;
      return {
        contact: bestContact,
        notes,
        screenshotPath: lastScreenshot,
        deniedUrl: lastDeniedUrl,
        lastAttemptedUrl,
        applicantPhoneNumber: bestApplicantPhone,
      };
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
  ): Promise<VirtualFolderResult> {
    const notes: DiagnosticNote[] = [];
    console.log(
      `Processing Virtual Job Folder for Job: ${jobNumber}, Doc: ${docNumber}`,
    );

    const appDetails = await this.extractBisApplicationDetails(
      jobNumber,
      docNumber,
    );
    const fromApp = this.contactsFromAppDetails(appDetails);

    const folderUrl = `https://a810-bisweb.nyc.gov/bisweb/BScanVirtualJobFolderServlet?passjobnumber=${jobNumber}&passdocnumber=${docNumber}&allbin=${bin}`;
    let lastAttemptedUrl = folderUrl;

    const folderPage = await this.newPage();

    try {
      await this.retryOperation(async () => {
        await folderPage.goto(folderUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });

        await folderPage.waitForLoadState('domcontentloaded');
        await folderPage.waitForLoadState('networkidle');
      });

      const scanCode = await folderPage.evaluate(() => {
        const rows = document.querySelectorAll('tr');
        for (const row of rows) {
          const formNameCell = row.querySelector('td:first-child a');
          if (
            formNameCell?.textContent?.trim() ===
            'PLAN / WORK APPROVAL APPLICATION'
          ) {
            const scanCodeCell = row.querySelector('td:last-child');
            return scanCodeCell?.textContent?.trim() || null;
          }
        }
        return null;
      });

      if (!scanCode) {
        console.log('No PLAN / WORK APPROVAL APPLICATION form found');
        notes.push({
          stage: 'BIS',
          code: 'BIS_NO_PW1_FORM',
          detail: `job ${jobNumber} doc ${docNumber}`,
        });
        return {
          contact: fromApp.contact,
          applicantPhoneNumber: fromApp.applicantPhoneNumber,
          notes,
          lastAttemptedUrl,
          screenshotPath: await this.debugPageReturnPath(
            folderPage,
            'bis-no-pw1',
          ),
        };
      }

      console.log(`Found scan code: ${scanCode}`);

      const documentPage = await this.newPage();
      const documentUrl = `https://a810-bisweb.nyc.gov/bisweb/BScanJobDocumentServlet?passjobnumber=${jobNumber}&passdocnumber=${docNumber}&allbin=${bin}&scancode=${scanCode}`;
      lastAttemptedUrl = documentUrl;

      try {
        await this.retryOperation(async () => {
          await documentPage.goto(documentUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
        });

        const pdfOutcome = await this.getPdfFromIframe(
          documentPage,
          documentUrl,
        );
        if (!pdfOutcome.path) {
          console.log('No PDF content found');
          notes.push({
            stage: 'BIS_PDF',
            code: 'BIS_PDF_DOWNLOAD_FAILED',
            detail: pdfOutcome.detail || `url=${pdfOutcome.deniedUrl || documentUrl}`,
          });
          if (
            pdfOutcome.status === 403 ||
            pdfOutcome.detail?.includes('403') ||
            pdfOutcome.detail?.toLowerCase().includes('access denied')
          ) {
            notes.push({
              stage: 'ACCESS',
              code: 'ACCESS_POSSIBLE_BLOCK',
              detail: `HTTP ${pdfOutcome.status || 403} on PDF`,
            });
          }
          return {
            contact: {
              name: fromApp.contact.name,
              phoneNumber: fromApp.contact.phoneNumber,
              email: undefined,
            },
            applicantPhoneNumber: fromApp.applicantPhoneNumber,
            notes,
            lastAttemptedUrl,
            screenshotPath: await this.debugPageReturnPath(
              documentPage,
              'bis-no-pdf',
            ),
            deniedUrl: pdfOutcome.deniedUrl || documentUrl,
          };
        }

        const pdfContact =
          await this.geminiService.extractContactInfoFromPdf(pdfOutcome.path);
        if (!pdfContact) {
          console.log('Could not extract contact information from PDF');
          notes.push({
            stage: 'GEMINI',
            code: 'GEMINI_PARSE_OR_EMPTY',
            detail: 'no owner fields from PW1 PDF',
          });
          return {
            contact: {
              name: fromApp.contact.name,
              phoneNumber: fromApp.contact.phoneNumber,
              email: fromApp.contact.email,
            },
            applicantPhoneNumber: fromApp.applicantPhoneNumber,
            notes,
            lastAttemptedUrl,
          };
        }

        console.log('Successfully extracted contact information from PDF');
        return {
          contact: {
            email: pdfContact.email || fromApp.contact.email,
            phoneNumber:
              pdfContact.phoneNumber || fromApp.contact.phoneNumber,
            name: pdfContact.name || fromApp.contact.name,
          },
          applicantPhoneNumber: fromApp.applicantPhoneNumber,
          notes: [],
          lastAttemptedUrl,
        };
      } finally {
        await documentPage.close();
      }
    } catch (error) {
      console.error(
        `Error processing Virtual Job Folder for Job ${jobNumber}: ${error.message}`,
      );
      notes.push({
        stage: 'BIS',
        code: 'BIS_FOLDER_ERROR',
        detail: error.message?.slice(0, 200),
      });
      return {
        contact: fromApp.contact,
        applicantPhoneNumber: fromApp.applicantPhoneNumber,
        notes,
        lastAttemptedUrl,
        screenshotPath: await this.debugPageReturnPath(
          folderPage,
          'bis-folder-error',
        ),
      };
    } finally {
      await folderPage.close();
    }
  }

  private isBisPdfResponse(response: Response): boolean {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    return (
      url.includes('bisweb') &&
      (contentType.includes('application/pdf') ||
        url.includes('JobDocumentContent') ||
        url.includes('JobDocument'))
    );
  }

  private async sessionHeaders(
    page: Page,
  ): Promise<Record<string, string>> {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const userAgent = await page.evaluate(() => navigator.userAgent);
    return {
      Referer: page.url(),
      Cookie: cookieHeader,
      'User-Agent': userAgent,
      Accept: 'application/pdf,*/*',
    };
  }

  private savePdfBuffer(buffer: Buffer): { path: string; isPdf: boolean } {
    const pdfPath = `temp_${Date.now()}.pdf`;
    fs.writeFileSync(pdfPath, buffer);
    const sizeKb = (buffer.byteLength / 1024).toFixed(1);
    const header = buffer.slice(0, 5).toString('ascii');
    const isPdf = header.startsWith('%PDF');
    console.log(
      `PDF buffer saved to ${pdfPath} | size=${sizeKb}KB | header="${header}" | isPDF=${isPdf}`,
    );
    if (!isPdf) {
      const preview = buffer.slice(0, 300).toString('utf8').replace(/\n/g, ' ');
      console.warn(`Non-PDF content received. Preview: ${preview}`);
    }
    return { path: pdfPath, isPdf };
  }

  /**
   * BIS PDFs often 403 on bare API requests. Prefer the browser's own iframe load,
   * then fall back to a cookie/referer-aware fetch.
   */
  private async getPdfFromIframe(
    page: Page,
    fallbackDeniedUrl?: string,
  ): Promise<{
    path: string | null;
    deniedUrl?: string;
    status?: number;
    detail?: string;
  }> {
    try {
      const pdfResponsePromise = page
        .waitForResponse((res) => this.isBisPdfResponse(res), {
          timeout: 60000,
        })
        .catch(() => null);

      const iframe = await page.waitForSelector('iframe', { timeout: 60000 });
      if (!iframe) {
        console.log('No iframe found');
        return {
          path: null,
          deniedUrl: fallbackDeniedUrl,
          detail: 'No iframe element',
        };
      }

      const frame = await iframe.contentFrame();
      if (frame) {
        await frame.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
        await frame
          .waitForLoadState('networkidle', { timeout: 60000 })
          .catch(() => {});
      }

      const iframeSrc = await iframe.getAttribute('src');
      if (!iframeSrc) {
        console.log('Iframe has no src attribute');
        return {
          path: null,
          deniedUrl: fallbackDeniedUrl,
          detail: 'Iframe has no src',
        };
      }

      const pdfUrl = iframeSrc.startsWith('http')
        ? iframeSrc
        : `https://a810-bisweb.nyc.gov/bisweb/${iframeSrc.replace(/^\//, '')}`;
      console.log(`Downloading PDF from ${pdfUrl}`);

      let response = await pdfResponsePromise;
      if (response?.ok()) {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/pdf')) {
          const saved = this.savePdfBuffer(await response.body());
          if (saved.isPdf) {
            return { path: saved.path };
          }
          // Browser PDF viewer intercepted — buffer is viewer HTML, not raw PDF
          console.warn(
            `Browser intercepted PDF as viewer HTML via pdfResponsePromise; falling back to direct fetch`,
          );
        }
      }

      response = await page.request.get(pdfUrl, {
        timeout: 60000,
        headers: await this.sessionHeaders(page),
      });
      const contentType = response.headers()['content-type'] || '';
      const status = response.status();
      if (!response.ok() || !contentType.includes('application/pdf')) {
        const preview = (await response.text().catch(() => '')).slice(0, 200);
        console.error(
          `Failed to download PDF. Status: ${status}, Content-Type: ${contentType}, Preview: ${preview}`,
        );
        await this.debugPage(page, 'bis-pdf-403');
        return {
          path: null,
          deniedUrl: pdfUrl,
          status,
          detail: `status=${status}, content-type=${contentType}, preview=${preview.slice(0, 80)}`,
        };
      }

      const saved = this.savePdfBuffer(await response.body());
      if (!saved.isPdf) {
        // Server returned 200 with application/pdf content-type but body is not a PDF
        // (e.g. Chrome PDF viewer HTML or another proxy page)
        console.error(
          `PDF URL returned non-PDF bytes despite 200/application/pdf headers`,
        );
        return {
          path: null,
          deniedUrl: pdfUrl,
          status,
          detail: `status=200, content-type=${contentType} but body is not a valid PDF`,
        };
      }
      return { path: saved.path };
    } catch (error) {
      console.error(`Error downloading PDF: ${error.message}`);
      await this.debugPage(page, 'bis-pdf-error');
      return {
        path: null,
        deniedUrl: fallbackDeniedUrl,
        detail: error.message,
      };
    }
  }

  /**
   * Scrapes DOB NOW website for asbestos-related documents for a given BIN
   * @param bin Building Identification Number
   * @returns Path to the downloaded PDF if found, null otherwise
   */
  async scrapeDobNow(bin: string): Promise<ContactExtractionOutcome> {
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
      return {
        contact: {},
        notes: [
          {
            stage: 'DOBNOW',
            code: 'DOBNOW_ERROR',
            detail: error.message?.slice(0, 200),
          },
        ],
        screenshotPath: await this.debugPageReturnPath(page, 'dobnow-error'),
      };
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
      await page.waitForSelector('.ui-grid-canvas .ui-grid-row', {
        timeout: 90000,
      });
      await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(
        () => {},
      );
    });
  }

  /**
   * Sorts the job list by modified date (ui-grid header — not always a role=button).
   */
  private async sortByModifiedDate(page: Page): Promise<void> {
    await this.retryOperation(async () => {
      await page.waitForSelector('.ui-grid-header', { timeout: 90000 });

      const modifiedHeader = page
        .locator('.ui-grid-header-cell')
        .filter({ hasText: /Modified\s*Date/i })
        .first();

      const headerCount = await modifiedHeader.count();
      if (headerCount > 0) {
        await modifiedHeader.click({ timeout: 60000 });
      } else {
        console.log(
          'ui-grid header not found, trying role=button for Modified Date',
        );
        await page.getByRole('button', { name: 'Modified Date' }).click({
          timeout: 60000,
        });
      }

      await page.waitForTimeout(2500);

      const sortAscending = page.getByRole('button', {
        name: /Modified Date Sort Ascending/i,
      });
      if ((await sortAscending.count()) > 0) {
        await sortAscending.first().click({ timeout: 30000 });
      } else {
        const menuSort = page
          .locator('.ui-grid-menu-item, [role="menuitem"]')
          .filter({ hasText: /ascending/i });
        if ((await menuSort.count()) > 0) {
          await menuSort.first().click({ timeout: 30000 });
        } else if (headerCount > 0) {
          await modifiedHeader.dblclick({ timeout: 30000 }).catch(() => {});
        }
      }

      await page.waitForTimeout(2500);
      await page.waitForSelector('.ui-grid-canvas .ui-grid-row', {
        timeout: 60000,
      });
    }).catch(async (err) => {
      await this.debugPage(page, 'dobnow-sort-modified-date');
      throw err;
    });
  }

  /**
   * Processes each job row and looks for asbestos documents
   * Returns the path to the downloaded PDF if found
   */
  private async processJobRows(page: Page): Promise<ContactExtractionOutcome> {
    const rows = await page.$$('.ui-grid-canvas > .ui-grid-row');
    let dialogCount = 1;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];

      if (await this.shouldSkipRow(row)) {
        continue;
      }

      const pdfPath = await this.processJobRow(page, row, dialogCount);
      if (pdfPath) {
        const contact =
          await this.geminiService.extractAsbestosInfoFromPdf(pdfPath);
        if (contact && hasAnyContact(contact)) {
          return { contact, notes: [] };
        }
        return {
          contact: contact || {},
          notes: [
            {
              stage: 'GEMINI',
              code: 'GEMINI_PARSE_OR_EMPTY',
              detail: 'DOB NOW asbestos PDF',
            },
          ],
        };
      }

      dialogCount++;
    }

    console.log('No asbestos documents found in any job');
    return {
      contact: {},
      notes: [
        {
          stage: 'DOBNOW',
          code: 'DOBNOW_NO_ASBESTOS_PDF',
        },
      ],
      screenshotPath: await this.debugPageReturnPath(page, 'dobnow-no-asbestos'),
    };
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
