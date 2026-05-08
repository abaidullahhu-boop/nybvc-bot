import * as dotenv from 'dotenv';
import * as cron from 'node-cron';
import { AppService } from './app.service';
import { NYCOpenDataService } from './nyc-open-data.service';
import { ResendMailService } from './resend-mail.service';
import { DobScraperService } from './dob-scrapper.service';
import { GeminiService } from './gemini.service';
import { GoogleSheetService } from './google-sheet.service';
import { BinTrackerService } from './bin-tracker.service';

dotenv.config();

// Function to create service instances
export function createServices() {
  const geminiService = new GeminiService();
  const dobScraperService = new DobScraperService(geminiService);
  const nycOpenDataService = new NYCOpenDataService();
  const resendMailService = new ResendMailService();
  const googleSheetService = new GoogleSheetService();
  const binTrackerService = new BinTrackerService();

  return {
    geminiService,
    dobScraperService,
    nycOpenDataService,
    resendMailService,
    googleSheetService,
    binTrackerService,
    appService: new AppService(
      nycOpenDataService,
      resendMailService,
      dobScraperService,
      googleSheetService,
    ),
  };
}

// Main daily task runner
async function runDailyTasks() {
  console.log('--- Daily tasks started ---');
  const { nycOpenDataService, binTrackerService, appService } = createServices();

  try {
    // Project 1: Get new BINs and scrape contact info
    console.log('Checking the last processed BIN...');
    const lastProcessedBin = await binTrackerService.getLastProcessedBin();
    console.log(`Last processed BIN: ${lastProcessedBin || 'None'}`);

    console.log('Getting the latest 200 BINs...');
    const latestBins = await nycOpenDataService.getNewBinsToday();
    console.log(`Retrieved ${latestBins.length} BINs from the NYC Open Data API`);

    const newBins = await nycOpenDataService.filterNewBins(latestBins, lastProcessedBin);
    console.log(`Found ${newBins.length} new BINs to process`);

    if (newBins.length > 0) {
      // Update last processed BIN before starting (so if it crashes midway, we don't reprocess)
      await binTrackerService.updateLastProcessedBin(newBins[0], newBins.length);
      console.log(`Updated last processed BIN to ${newBins[0]}`);

      // Process all BINs sequentially — no batching needed, no timeout on Render
      await appService.runProject1(newBins);
    } else {
      console.log('No new BINs to process today.');
    }

    // Project 2: Send violation alert emails
    await appService.runProject2();

    console.log('--- Daily tasks completed ---');
  } catch (error) {
    console.error('Daily tasks failed:', error);
  }
}

// Entry point
if (require.main === module) {
  const runNow = process.env.RUN_NOW === 'true';

  if (runNow) {
    // Useful for testing — run immediately without waiting for cron
    console.log('RUN_NOW=true detected, running tasks immediately...');
    runDailyTasks()
      .then(() => console.log('Done.'))
      .catch((err) => console.error(err));
  }

  // Schedule daily run at 7:30 AM NYC time
  cron.schedule(
    '30 7 * * *',
    async () => {
      console.log('Cron triggered at 7:30 AM NYC time');
      await runDailyTasks();
    },
    {
      timezone: 'America/New_York',
    },
  );

  console.log('Scheduler is running. Waiting for 7:30 AM NYC time...');

  // Also start the HTTP server for manual triggers and backfill
  import('./http-server').catch((error) => {
    console.error('Error starting HTTP server:', error);
  });
}
