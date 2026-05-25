import * as http from 'http';
import * as url from 'url';
import { createServices } from './index';

// Helper function to parse JSON body from request
async function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const bodyParts: any[] = [];
    req.on('data', (chunk) => {
      bodyParts.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(bodyParts).toString();
        const data = body ? JSON.parse(body) : {};
        resolve(data);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// Common response function
function sendResponse(res: http.ServerResponse, statusCode: number, data: any) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url || '', true);
  const path = parsedUrl.pathname;

  // Only accept POST requests
  if (req.method !== 'POST') {
    sendResponse(res, 405, {
      status: 'error',
      message: 'Only POST method is allowed',
    });
    return;
  }

  try {
    const requestData = await parseJsonBody(req).catch(() => ({}));

    // -----------------------------------------------------------------------
    // /trigger — manual trigger or backfill by dates
    // Use this to manually kick off Project 1 + Project 2 outside the cron
    // or to backfill specific dates by passing { "dates": ["YYYY-MM-DD"] }
    // -----------------------------------------------------------------------
    if (path === '/trigger') {
      console.log('Received manual trigger request');

      const { nycOpenDataService, binTrackerService, appService } = createServices();

      // Backfill mode: dates provided in request body
      const requestedDates: string[] = requestData.dates || [];
      if (Array.isArray(requestedDates) && requestedDates.length > 0) {
        console.log(`Backfill requested for dates: ${requestedDates.join(', ')}`);

        const results: any[] = [];
        for (const dateStr of requestedDates) {
          const binsForDate = await nycOpenDataService.getBinsForDates([dateStr]);
          console.log(`Date ${dateStr} returned ${binsForDate.length} BINs`);

          if (binsForDate.length === 0) {
            results.push({ date: dateStr, status: 'no_bins_found', binCount: 0 });
            continue;
          }

          await appService.runProject1(binsForDate, dateStr);
          results.push({ date: dateStr, status: 'processed', binCount: binsForDate.length });
        }

        sendResponse(res, 200, {
          status: 'success',
          message: 'Backfill completed',
          results,
        });
        return;
      }

      // Standard daily flow — same logic as the cron job
      console.log('Checking the last processed BIN...');
      const lastProcessedBin = await binTrackerService.getLastProcessedBin();
      console.log(`Last processed BIN: ${lastProcessedBin || 'None'}`);

      console.log('Getting the latest 200 BINs...');
      const latestBins = await nycOpenDataService.getNewBinsToday();
      console.log(`Retrieved ${latestBins.length} BINs`);

      const newBins = await nycOpenDataService.filterNewBins(latestBins, lastProcessedBin);
      console.log(`Found ${newBins.length} new BINs to process`);

      if (newBins.length === 0) {
        sendResponse(res, 200, {
          status: 'success',
          message: 'No new BINs to process',
          lastProcessedBin,
        });
        return;
      }

      // Update last processed BIN
      await binTrackerService.updateLastProcessedBin(newBins[0], newBins.length);

      // Process all BINs sequentially
      await appService.runProject1(newBins);

      sendResponse(res, 200, {
        status: 'success',
        message: 'Trigger completed successfully',
        processedBinsCount: newBins.length,
        lastProcessedBin: newBins[0],
      });

    // -----------------------------------------------------------------------
    // /process-bins — manually process a specific list of BINs
    // Body: { "bins": ["1234567", "2345678"], "sheetDate": "2024-01-15" }
    // -----------------------------------------------------------------------
    } else if (path === '/process-bins') {
      console.log('Received request to process a specific list of BINs');

      const bins = requestData.bins || [];
      const sheetDate = requestData.sheetDate;

      if (!bins.length) {
        sendResponse(res, 400, {
          status: 'error',
          message: 'No BINs provided in the request',
        });
        return;
      }

      console.log(`Processing ${bins.length} BINs: ${bins.join(', ')}`);

      const { appService } = createServices();

      try {
        await appService.runProject1(bins, sheetDate);
        sendResponse(res, 200, {
          status: 'success',
          message: `Successfully processed ${bins.length} BINs`,
          bins,
        });
      } catch (error) {
        console.error('Error processing BINs:', error);
        sendResponse(res, 500, {
          status: 'error',
          message: 'Error processing BINs',
          error: error.message,
        });
      }

    // -----------------------------------------------------------------------
    // /process-bins-by-dates — backfill BINs for specific dates
    // Body: { "dates": ["2024-01-15", "2024-01-16"] }
    // -----------------------------------------------------------------------
    } else if (path === '/process-bins-by-dates') {
      console.log('Received request to process BINs by dates');

      const dates = requestData.dates || [];

      if (!Array.isArray(dates) || dates.length === 0) {
        sendResponse(res, 400, {
          status: 'error',
          message: 'Request must include a non-empty "dates" array',
        });
        return;
      }

      const { nycOpenDataService, appService } = createServices();
      const results: any[] = [];

      for (const dateStr of dates) {
        console.log(`Fetching BINs for ${dateStr}`);
        const binsForDate = await nycOpenDataService.getBinsForDates([dateStr]);

        if (!binsForDate.length) {
          results.push({ date: dateStr, status: 'no_bins_found', binCount: 0 });
          continue;
        }

        console.log(`Processing ${binsForDate.length} BINs for date ${dateStr}`);
        await appService.runProject1(binsForDate, dateStr);
        results.push({ date: dateStr, status: 'processed', binCount: binsForDate.length });
      }

      sendResponse(res, 200, {
        status: 'success',
        message: 'Processed BINs for requested dates',
        results,
      });

    // -----------------------------------------------------------------------
    // /scrape-bin — single-BIN scrape dispatched by Cloud Tasks during Phase 3
    // Body: { bin, rowIndex, sheetName, priorNotes }
    // Each request handles one BIN end-to-end (BIS -> DOB NOW -> sheet update)
    // and stays well under the 60-minute Cloud Run timeout.
    // -----------------------------------------------------------------------
    } else if (path === '/scrape-bin') {
      const { bin, rowIndex, sheetName, priorNotes } = requestData || {};

      if (!bin || !rowIndex || !sheetName) {
        sendResponse(res, 400, {
          status: 'error',
          message:
            'Request must include "bin", "rowIndex", and "sheetName" fields',
        });
        return;
      }

      console.log(
        `Received /scrape-bin: bin=${bin}, rowIndex=${rowIndex}, sheetName=${sheetName}`,
      );

      const { appService, dobScraperService } = createServices();

      try {
        await dobScraperService.initializeBrowser();
        await appService.scrapeSingleBin(
          String(bin),
          Number(rowIndex),
          String(sheetName),
          Array.isArray(priorNotes) ? priorNotes : [],
        );
        sendResponse(res, 200, {
          status: 'success',
          message: `Scraped BIN ${bin} at row ${rowIndex}`,
        });
      } catch (error) {
        console.error(`/scrape-bin failed for BIN ${bin}:`, error);
        sendResponse(res, 500, {
          status: 'error',
          message: `Error scraping BIN ${bin}`,
          error: error.message,
        });
      } finally {
        await dobScraperService.cleanup().catch((err) => {
          console.error('Browser cleanup failed:', err);
        });
      }

    // -----------------------------------------------------------------------
    // /run-project2 — manually trigger Project 2 violation emails only
    // -----------------------------------------------------------------------
    } else if (path === '/run-project2') {
      console.log('Received request to run Project 2');

      const { appService } = createServices();

      try {
        await appService.runProject2();
        sendResponse(res, 200, {
          status: 'success',
          message: 'Project 2 completed successfully',
        });
      } catch (error) {
        console.error('Error running Project 2:', error);
        sendResponse(res, 500, {
          status: 'error',
          message: 'Error running Project 2',
          error: error.message,
        });
      }

    } else {
      sendResponse(res, 404, {
        status: 'error',
        message: 'Endpoint not found',
      });
    }
  } catch (error) {
    console.error('Server error:', error);
    sendResponse(res, 500, {
      status: 'error',
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});
