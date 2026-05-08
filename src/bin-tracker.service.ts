import { Datastore } from '@google-cloud/datastore';

// Entity kind for tracking BINs in Datastore
const BIN_TRACKING_KIND = 'BinTracking';
const LAST_PROCESSED_BIN_KEY = 'last_processed_bin';

/**
 * Service to track the last processed BIN using Google Datastore
 */
export class BinTrackerService {
  private readonly datastore: Datastore;

  constructor() {
    this.datastore = new Datastore({
      keyFilename: process.env.GOOGLE_DATASTORE_CREDENTIALS_PATH,
    });
  }

  /**
   * Gets the last processed BIN
   * @returns The last processed BIN or null if none has been processed
   */
  async getLastProcessedBin(): Promise<string | null> {
    try {
      const key = this.datastore.key([
        BIN_TRACKING_KIND,
        LAST_PROCESSED_BIN_KEY,
      ]);
      const [entity] = await this.datastore.get(key);

      if (!entity || !entity.bin) {
        console.log('No last processed BIN found in Datastore');
        return null;
      }

      console.log(`Retrieved last processed BIN from Datastore: ${entity.bin}`);
      return entity.bin;
    } catch (error) {
      console.error('Error getting last processed BIN from Datastore:', error);
      return null;
    }
  }

  /**
   * Updates the last processed BIN
   * @param bin The BIN to set as the last processed
   * @param count The number of BINs processed in the batch
   */
  async updateLastProcessedBin(bin: string, count: number): Promise<void> {
    try {
      const key = this.datastore.key([
        BIN_TRACKING_KIND,
        LAST_PROCESSED_BIN_KEY,
      ]);
      const entity = {
        key,
        data: {
          bin,
          count,
          timestamp: new Date().toISOString(),
        },
      };

      await this.datastore.save(entity);
      console.log(`Updated last processed BIN to ${bin} in Datastore`);
    } catch (error) {
      console.error('Error updating last processed BIN in Datastore:', error);
      throw error;
    }
  }
}
