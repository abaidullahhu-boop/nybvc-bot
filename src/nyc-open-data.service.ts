import axios, { AxiosError } from 'axios';
import {
  DobEcbViolation,
  DobViolation,
  DobComplaintReceived,
  DobSafetyViolation,
  HousingMaintenanceCodeViolation,
  HousingLitigation,
  OrderToRepairVacateOrder,
  HousingMaintenanceCodeComplaintAndProblem,
  RodentInspectionViolation,
} from './types';
import * as dayjs from 'dayjs';
import * as timezone from 'dayjs/plugin/timezone';
import * as utc from 'dayjs/plugin/utc';

dayjs.extend(timezone);
dayjs.extend(utc);

export class NYCOpenDataService {
  private readonly socrataAppToken = process.env.SOCRATA_APP_TOKEN;

  async getDobEcbViolations(bin: string): Promise<DobEcbViolation[]> {
    const url = 'https://data.cityofnewyork.us/resource/6bgk-3dad.json';
    return this.fetchData<DobEcbViolation>(url, bin, 'DOB ECB Violations');
  }

  async getDOBViolations(bin: string): Promise<DobViolation[]> {
    const url = 'https://data.cityofnewyork.us/resource/3h2n-5cm9.json';
    return this.fetchData<DobViolation>(url, bin, 'DOB Violations');
  }

  async getDOBComplaintsReceived(bin: string): Promise<DobComplaintReceived[]> {
    const url = 'https://data.cityofnewyork.us/resource/eabe-havv.json';
    return this.fetchData<DobComplaintReceived>(
      url,
      bin,
      'DOB Complaints Received',
    );
  }

  async getDOBSafetyViolations(bin: string): Promise<DobSafetyViolation[]> {
    const url = 'https://data.cityofnewyork.us/resource/855j-jady.json';
    return this.fetchData<DobSafetyViolation>(
      url,
      bin,
      'DOB Safety Violations',
    );
  }

  async getHousingMaintenanceCodeViolations(
    bin: string,
  ): Promise<HousingMaintenanceCodeViolation[]> {
    const url = 'https://data.cityofnewyork.us/resource/wvxf-dwi5.json';
    return this.fetchData<HousingMaintenanceCodeViolation>(
      url,
      bin,
      'Housing Maintenance Code Violations',
    );
  }

  async getHousingLitigations(bin: string): Promise<HousingLitigation[]> {
    const url = 'https://data.cityofnewyork.us/resource/59kj-x8nc.json';
    return this.fetchData<HousingLitigation>(url, bin, 'Housing Litigations');
  }

  async getOrderToRepairVacateOrders(
    bin: string,
  ): Promise<OrderToRepairVacateOrder[]> {
    const url = 'https://data.cityofnewyork.us/resource/tb8q-a3ar.json';
    return this.fetchData<OrderToRepairVacateOrder>(
      url,
      bin,
      'Order to Repair/Vacate Orders',
    );
  }

  async getHousingMaintenanceCodeComplaintsAndProblems(
    bin: string,
  ): Promise<HousingMaintenanceCodeComplaintAndProblem[]> {
    const url = 'https://data.cityofnewyork.us/resource/ygpa-z7cr.json';
    return this.fetchData<HousingMaintenanceCodeComplaintAndProblem>(
      url,
      bin,
      'Housing Maintenance Code Complaints and Problems',
    );
  }

  async getRodentInspectionViolations(
    bin: string,
  ): Promise<RodentInspectionViolation[]> {
    const url = 'https://data.cityofnewyork.us/resource/p937-wjvj.json';
    return this.fetchData<RodentInspectionViolation>(
      url,
      bin,
      'Rodent Inspection Violations',
    );
  }

  /**
   * Fetches owner name and phone from the DOB Job Application Filings dataset.
   * The `bin__` column (note double underscore) is the BIN field in this dataset.
   * Returns the most recent record that has a phone number, or the most recent record overall.
   */
  async getOwnerContactFromJobApplications(bin: string): Promise<{
    name?: string;
    phoneNumber?: string;
  } | null> {
    try {
      const url = 'https://data.cityofnewyork.us/resource/ic3t-wcy2.json';
      const response = await axios.get(url, {
        headers: this.socrataAppToken
          ? { 'X-App-Token': this.socrataAppToken }
          : {},
        params: {
          $where: `bin__ = '${bin}'`,
          $select:
            'owner_s_first_name,owner_s_last_name,owner_s_business_name,owner_sphone__',
          $order: 'latest_action_date DESC',
          $limit: 10,
        },
      });

      const records: any[] = response.data || [];
      console.log(
        `DOB job applications API response for BIN ${bin} (${records.length} records):`,
        JSON.stringify(records, null, 2),
      );
      if (records.length === 0) {
        console.log(
          `No job application records found for BIN ${bin} in DOB dataset`,
        );
        return null;
      }

      const withPhone = records.find(
        (r) => r.owner_sphone__ && r.owner_sphone__.trim(),
      );
      const record = withPhone || records[0];

      const firstName = (record.owner_s_first_name || '').trim();
      const lastName = (record.owner_s_last_name || '').trim();
      const businessName = (record.owner_s_business_name || '').trim();

      let name: string | undefined;
      if (firstName || lastName) {
        name = [firstName, lastName].filter(Boolean).join(' ') || undefined;
      } else if (businessName && businessName.toUpperCase() !== 'N/A') {
        name = businessName;
      }

      const phoneNumber = record.owner_sphone__?.trim() || undefined;

      console.log(
        `API owner contact for BIN ${bin}: name=${name || '(none)'}, phone=${phoneNumber || '(none)'}`,
      );
      return { name, phoneNumber };
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to fetch owner contact from job applications for BIN ${bin}`,
      );
      return null;
    }
  }

  async getNewBinsToday(): Promise<string[]> {
    //const today = dayjs().tz('America/New_York').format('YYYYMMDD');
    console.log(`Fetching the 200 most recent BINs`);
    const datasets = [
      {
        url: 'https://data.cityofnewyork.us/resource/6bgk-3dad.json',
        dateField: 'issue_date',
      },
    ];

    const binPromises = datasets.map(async (dataset) => {
      try {
        const response = await axios.get(dataset.url, {
          headers: this.socrataAppToken
            ? { 'X-App-Token': this.socrataAppToken }
            : {},
          params: {
            //issue_date: today,
            $select: 'bin',
            $order: `${dataset.dateField} DESC`,
            $limit: 200,
          },
        });
        console.log(`Fetched ${response.data.length} most recent BINs`);
        const filteredBins = response.data
          .filter(
            (item: any) =>
              item.bin !== null && item.bin !== undefined && item.bin !== '',
          )
          .filter(
            (item: any, index: number, self: any) =>
              self.findIndex((t: any) => t.bin === item.bin) === index,
          )
          .map((item: any) => item.bin);
        console.log(`Filtered ${filteredBins.length} unique BINs`);
        return filteredBins;
      } catch (error) {
        this.handleAxiosError(
          error,
          `Failed to fetch recent BINs from ${dataset.url}`,
        );
        return [];
      }
    });

    const binArrays = await Promise.all(binPromises);
    const allBins = binArrays.flat();
    const uniqueBins = [...new Set(allBins)];
    return uniqueBins;
  }

  /**
   * Fetch BINs whose issue_date falls on any of the provided dates.
   * Dates can be provided in either YYYY-MM-DD or MM/DD/YYYY formats.
   */
  async getBinsForDates(dates: string[]): Promise<string[]> {
    if (!Array.isArray(dates) || dates.length === 0) {
      return [];
    }

    const dataset = {
      url: 'https://data.cityofnewyork.us/resource/6bgk-3dad.json',
      dateField: 'issue_date',
    };

    const binArrays = await Promise.all(
      dates.map(async (dateStr) => {
        const day = dayjs.tz(dateStr, 'America/New_York');
        if (!day.isValid()) {
          console.warn(`Skipped invalid date: ${dateStr}`);
          return [];
        }

        const start = day.startOf('day').toISOString();
        const end = day.endOf('day').toISOString();

        try {
          const response = await axios.get(dataset.url, {
            headers: this.socrataAppToken
              ? { 'X-App-Token': this.socrataAppToken }
              : {},
            params: {
              $select: 'bin',
              $where: `${dataset.dateField} between '${start}' and '${end}'`,
              $order: `${dataset.dateField} DESC`,
              $limit: 500,
            },
          });

          const filteredBins = response.data
            .filter(
              (item: any) =>
                item.bin !== null && item.bin !== undefined && item.bin !== '',
            )
            .map((item: any) => item.bin);

          console.log(
            `Fetched ${filteredBins.length} BINs for ${day.format('YYYY-MM-DD')}`,
          );
          return filteredBins;
        } catch (error) {
          this.handleAxiosError(
            error,
            `Failed to fetch BINs for ${dateStr} from ${dataset.url}`,
          );
          return [];
        }
      }),
    );

    const allBins = binArrays.flat();
    return [...new Set(allBins)];
  }

  async filterNewBins(
    bins: string[],
    lastProcessedBin: string | null,
  ): Promise<string[]> {
    if (!lastProcessedBin) {
      console.log('No last processed BIN found, returning all BINs');
      return bins;
    }

    // Get index of the last processed BIN
    const lastProcessedIndex = bins.findIndex(
      (bin) => bin === lastProcessedBin,
    );

    if (lastProcessedIndex === -1) {
      // Last processed BIN not found in the current list, return all
      console.log(
        `Last processed BIN ${lastProcessedBin} not found in current list, returning all BINs`,
      );
      return bins;
    }

    // Return BINs that come before the last processed one in the list (newer BINs)
    // Since the list is ordered by date DESC, newer BINs are at the beginning
    const newBins = bins.slice(0, lastProcessedIndex);
    console.log(
      `Found ${newBins.length} new BINs to process (after filtering based on last processed BIN ${lastProcessedBin})`,
    );
    return newBins;
  }

  private async fetchData<T>(
    url: string,
    bin: string,
    datasetName: string,
  ): Promise<T[]> {
    try {
      const response = await axios.get(url, {
        headers: this.socrataAppToken
          ? { 'X-App-Token': this.socrataAppToken }
          : {},
        params: { bin },
      });
      return response.data as T[];
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to fetch ${datasetName} (BIN ${bin})`,
      );
      return [];
    }
  }

  private handleAxiosError(error: any, message: string) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        console.error(
          `${message} - Status: ${axiosError.response.status}, Data:`,
          axiosError.response.data,
        );
      } else if (axiosError.request) {
        console.error(`${message} - No response received:`, axiosError.request);
      } else {
        console.error(
          `${message} - Error setting up request:`,
          axiosError.message,
        );
      }
    } else {
      console.error(`${message} - Non-Axios error:`, error);
    }
  }
}
