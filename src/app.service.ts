import { NYCOpenDataService } from './nyc-open-data.service';
import { ResendMailService } from './resend-mail.service';
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
import { DobScraperService } from './dob-scrapper.service';
import { GoogleSheetService } from './google-sheet.service';
import { Datastore } from '@google-cloud/datastore';
import * as moment from 'moment-timezone';

export class AppService {
  private readonly datastore = new Datastore({
    keyFilename: process.env.GOOGLE_DATASTORE_CREDENTIALS_PATH,
  });

  constructor(
    private readonly nycOpenDataService: NYCOpenDataService,
    private readonly resendMailService: ResendMailService,
    private readonly dobScraperService: DobScraperService,
    private readonly googleSheetService: GoogleSheetService,
  ) {}

  async handleDailyTasks() {
    console.log('--- Running daily tasks at 10 AM NYC time ---');
    try {
      await this.runProject1();
      await this.runProject2();
      console.log('--- Daily tasks completed successfully. ---');
    } catch (error) {
      console.error('Daily task failed:', error);
    }
  }

  async runProject1(
    specificBins: string[] = [],
    sheetDate?: string,
  ): Promise<void> {
    console.log('Starting Project 1 workflow...');
    const binsToProcess = Array.from(new Set(specificBins || []));

    if (binsToProcess.length === 0) {
      console.log('No BINs provided for Project 1; nothing to process.');
      return;
    }

    try {
      // Allow overriding the sheet date to backfill past days
      const targetDate = sheetDate
        ? moment.tz(sheetDate, 'America/New_York')
        : moment().tz('America/New_York');

      if (!targetDate.isValid()) {
        throw new Error(
          `Invalid sheetDate provided (${sheetDate}). Use MM/DD/YYYY or YYYY-MM-DD format.`,
        );
      }

      const sheetName = targetDate.format('MM/DD/YYYY');
      const sheetId = process.env.PROJECT1_GOOGLE_SHEET_ID;

      if (!sheetId) {
        console.error(
          'PROJECT1_GOOGLE_SHEET_ID environment variable is not set',
        );
        return;
      }

      // Check if sheet exists for the target date, create if not
      console.log(`Checking if sheet for ${sheetName} exists...`);
      const sheetExists = await this.googleSheetService.sheetExists(
        sheetId,
        sheetName,
      );

      if (!sheetExists) {
        console.log(`Creating new sheet for ${sheetName}...`);
        await this.googleSheetService.createSheet(sheetId, sheetName);
        // Add header row
        await this.googleSheetService.appendRow(sheetId, sheetName, [
          ['BIN', 'Email', 'Phone', 'Name'],
        ]);
        console.log(`Created new sheet for ${sheetName} with headers`);
      } else {
        console.log(`Sheet for ${sheetName} already exists`);
      }

      await this.dobScraperService.initializeBrowser();
      for (const bin of binsToProcess) {
        console.log(`Processing BIN ${bin}`);
        const waitTime = Math.floor(Math.random() * 120000) + 60000; // 1 minute to 3 minutes
        console.log(`Waiting for ${waitTime / 60000} minutes...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        let contactInfo = await this.dobScraperService.getBisContactInfo(bin);
        const bisContactInfo = { ...contactInfo }; // Save original BIS contact info

        // Check if any contact info is missing
        if (
          !contactInfo ||
          !contactInfo.email ||
          !contactInfo.phoneNumber ||
          !contactInfo.name
        ) {
          // Get DOB Now info
          const dobNowContactInfo =
            await this.dobScraperService.scrapeDobNow(bin);

          // Merge the results, keeping BIS values if DOB Now returns empty
          contactInfo = {
            email: dobNowContactInfo?.email || bisContactInfo?.email || '',
            phoneNumber:
              dobNowContactInfo?.phoneNumber ||
              bisContactInfo?.phoneNumber ||
              '',
            name: dobNowContactInfo?.name || bisContactInfo?.name || '',
          };
        }

        const email = contactInfo?.email || '';
        const phone = contactInfo?.phoneNumber || '';
        const name = contactInfo?.name || '';

        const row = [bin];
        if (email !== 'string' && email !== '') {
          row.push(email);
        } else {
          row.push('Email not found');
        }
        if (phone !== 'string' && phone !== '') {
          row.push(phone);
        } else {
          row.push('Phone not found');
        }
        if (name !== 'string' && name !== '') {
          row.push(name);
        } else {
          row.push('Name not found');
        }
        await this.googleSheetService.appendRow(sheetId, sheetName, [row]);
        console.log(`Appended row for BIN ${bin}: [${row.join(', ')}]`);
      }
    } catch (error) {
      console.error('Project 1 workflow failed:', error);
    } finally {
      await this.dobScraperService.cleanup();
    }
    console.log('Project 1 workflow completed.');
  }

  public async runProject2() {
    console.log('Starting Project 2 workflow...');
    const today = moment().tz('America/New_York').format('YYYY-MM-DD');

    // Load BIN records from Google Sheet
    console.log('Loading BIN records from Google Sheet...');
    const sheetId = process.env.PROJECT2_GOOGLE_SHEET_ID;
    const sheetName = process.env.PROJECT2_GOOGLE_SHEET_NAME;

    if (!sheetId || !sheetName) {
      console.error(
        'PROJECT2_GOOGLE_SHEET_ID or PROJECT2_GOOGLE_SHEET_NAME environment variable is not set',
      );
      return;
    }

    let binRecords = [];
    try {
      const sheetData = await this.googleSheetService.getSheetData(
        sheetId,
        sheetName,
      );

      // Skip header row and map to required format
      if (sheetData.length > 1) {
        const headerRow = sheetData[0];
        const emailIndex = headerRow.findIndex(
          (col) => col.toLowerCase() === 'email',
        );
        const binIndex = headerRow.findIndex(
          (col) => col.toLowerCase() === 'bin',
        );

        if (emailIndex === -1 || binIndex === -1) {
          console.error('Sheet must contain "email" and "bin" columns');
          return;
        }

        binRecords = sheetData
          .slice(1)
          .map((row) => ({
            ownerEmail: row[emailIndex],
            bin: row[binIndex],
          }))
          .filter((record) => record.ownerEmail && record.bin);

        console.log(`Loaded ${binRecords.length} BIN records from sheet`);
      } else {
        console.log('Sheet is empty or contains only header row');
        return;
      }
    } catch (error) {
      console.error('Failed to load BIN records from sheet:', error);
      return;
    }

    for (const record of binRecords) {
      const { bin, ownerEmail } = record;
      if (!bin || !ownerEmail) {
        continue;
      }

      // Fetch all violation data
      const dobEcbViolations =
        await this.nycOpenDataService.getDobEcbViolations(bin);
      const dobViolations = await this.nycOpenDataService.getDOBViolations(bin);
      const dobComplaintsReceived =
        await this.nycOpenDataService.getDOBComplaintsReceived(bin);
      const dobSafetyViolations =
        await this.nycOpenDataService.getDOBSafetyViolations(bin);
      const housingMaintenanceCodeViolations =
        await this.nycOpenDataService.getHousingMaintenanceCodeViolations(bin);
      const housingLitigations =
        await this.nycOpenDataService.getHousingLitigations(bin);
      const orderToRepairVacateOrders =
        await this.nycOpenDataService.getOrderToRepairVacateOrders(bin);
      const housingMaintenanceCodeComplaintsAndProblems =
        await this.nycOpenDataService.getHousingMaintenanceCodeComplaintsAndProblems(
          bin,
        );
      const rodentInspectionViolations =
        await this.nycOpenDataService.getRodentInspectionViolations(bin);

      // Define violation types with their data and ID fields
      const violationTypes = [
        {
          type: 'DobEcbViolation',
          data: dobEcbViolations,
          idField: 'ecb_violation_number',
        },
        {
          type: 'DobViolation',
          data: dobViolations,
          idField: 'violation_number',
        },
        {
          type: 'DobComplaintReceived',
          data: dobComplaintsReceived,
          idField: 'complaint_number',
        },
        {
          type: 'DobSafetyViolation',
          data: dobSafetyViolations,
          idField: 'violation_number',
        },
        {
          type: 'HousingMaintenanceCodeViolation',
          data: housingMaintenanceCodeViolations,
          idField: 'violationid',
        },
        {
          type: 'HousingLitigation',
          data: housingLitigations,
          idField: 'litigationid',
        },
        {
          type: 'OrderToRepairVacateOrder',
          data: orderToRepairVacateOrders,
          idField: 'vacate_order_number',
        },
        {
          type: 'HousingMaintenanceCodeComplaintAndProblem',
          data: housingMaintenanceCodeComplaintsAndProblems,
          idField: 'problem_id',
        },
        {
          type: 'RodentInspectionViolation',
          data: rodentInspectionViolations,
          idField: 'job_ticket_or_work_order_id',
        },
      ];

      // Filter new violations
      const newViolations: { [key: string]: any[] } = {};
      let hasNewViolations = false;
      for (const vt of violationTypes) {
        const sentIds = await this.getSentViolationIds(
          ownerEmail,
          bin,
          vt.type,
        );
        const unsentData = vt.data.filter(
          (v) => !sentIds.includes(v[vt.idField]),
        );
        const uniqueNewData = Array.from(
          new Map(unsentData.map((v) => [v[vt.idField], v])).values(),
        );
        newViolations[vt.type] = uniqueNewData;
        if (uniqueNewData.length > 0) {
          hasNewViolations = true;
        }
      }

      // Send email if there are new violations
      if (hasNewViolations) {
        const { htmlContent, plainTextContent } = this.buildHtmlEmail(
          bin,
          newViolations['DobEcbViolation'],
          newViolations['DobViolation'],
          newViolations['DobComplaintReceived'],
          newViolations['DobSafetyViolation'],
          newViolations['HousingMaintenanceCodeViolation'],
          newViolations['HousingLitigation'],
          newViolations['OrderToRepairVacateOrder'],
          newViolations['HousingMaintenanceCodeComplaintAndProblem'],
          newViolations['RodentInspectionViolation'],
        );
        try {
          await this.resendMailService.sendEmail(
            ownerEmail,
            `New NYC Violations for BIN ${bin}`,
            htmlContent,
            plainTextContent,
          );
          console.log(`Email sent for BIN ${bin} to ${ownerEmail}.`);

          // Record new violations in Datastore
          const newSentEntities = [];
          for (const vt of violationTypes) {
            for (const v of newViolations[vt.type]) {
              const key = this.datastore.key([
                'SentViolation',
                `${ownerEmail}:${bin}:${vt.type}:${v[vt.idField]}`,
              ]);
              newSentEntities.push({
                key,
                data: {
                  email: ownerEmail,
                  bin,
                  violation_type: vt.type,
                  violation_id: v[vt.idField],
                  sent_date: today,
                },
              });
            }
          }
          await this.recordSentViolations(newSentEntities);
        } catch (emailError) {
          console.error(`Failed to send email for BIN ${bin}:`, emailError);
        }
      } else {
        console.log(
          `No new violations for BIN ${bin} and email ${ownerEmail}. Skipping email.`,
        );
      }
    }
    console.log('Project 2 workflow completed.');
  }

  private async getSentViolationIds(
    email: string,
    bin: string,
    violationType: string,
  ): Promise<string[]> {
    const query = this.datastore
      .createQuery('SentViolation')
      .filter('email', '=', email)
      .filter('bin', '=', bin)
      .filter('violation_type', '=', violationType)
      .select('violation_id');
    const [entities] = await this.datastore.runQuery(query);
    return entities.map((e) => e.violation_id);
  }

  private async recordSentViolations(entities: any[]): Promise<void> {
    await this.datastore.save(entities);
  }

  private buildHtmlEmail(
    bin: string,
    dobEcbViolations: DobEcbViolation[],
    dobViolations: DobViolation[],
    dobComplaintsReceived: DobComplaintReceived[],
    dobSafetyViolations: DobSafetyViolation[],
    housingMaintenanceCodeViolations: HousingMaintenanceCodeViolation[],
    housingLitigations: HousingLitigation[],
    orderToRepairVacateOrders: OrderToRepairVacateOrder[],
    housingMaintenanceCodeComplaintsAndProblems: HousingMaintenanceCodeComplaintAndProblem[],
    rodentInspectionViolations: RodentInspectionViolation[],
  ): { htmlContent: string; plainTextContent: string } {
    const htmlContent = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
      <h2 style="color: #333; font-size: 24px; text-align: center;">NYC Building Violations Report</h2>
      <p style="font-size: 16px; color: #555; text-align: center;"><strong>BIN:</strong> ${bin}</p>
  
      <!-- DOB ECB Violations -->
      <div style="background-color: #fff; padding: 15px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px;">
        <h3 style="color: #007bff; font-size: 18px; margin-top: 0;">DOB ECB Violations (${dobEcbViolations.length})</h3>
        ${
          dobEcbViolations.length > 0
            ? `<ul style="list-style-type: none; padding: 0;">${dobEcbViolations
                .map(
                  (v) =>
                    `<li style="margin-bottom: 10px;">Violation #${v.ecb_violation_number || 'N/A'} - Status: ${v.ecb_violation_status || 'Unknown'} - Issue Date: ${v.issue_date || 'N/A'} - Type: ${v.violation_type || 'N/A'}</li>`,
                )
                .join('')}</ul>`
            : `<p style="font-style: italic; color: #999;">No DOB ECB Violations found.</p>`
        }
      </div>
  
      <!-- DOB Violations -->
      <div style="background-color: #fff; padding: 15px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px;">
        <h3 style="color: #007bff; font-size: 18px; margin-top: 0;">DOB Violations (${dobViolations.length})</h3>
        ${
          dobViolations.length > 0
            ? `<ul style="list-style-type: none; padding: 0;">${dobViolations
                .map(
                  (v) =>
                    `<li style="margin-bottom: 10px;">Violation #${v.violation_number || 'N/A'} - Type: ${v.violation_type || 'Unknown'} - Issue Date: ${v.issue_date || 'N/A'}</li>`,
                )
                .join('')}</ul>`
            : `<p style="font-style: italic; color: #999;">No DOB Violations found.</p>`
        }
      </div>
  
      <!-- DOB Complaints Received -->
      <div style="background-color: #fff; padding: 15px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px;">
        <h3 style="color: #007bff; font-size: 18px; margin-top: 0;">DOB Complaints Received (${dobComplaintsReceived.length})</h3>
        ${
          dobComplaintsReceived.length > 0
            ? `<ul style="list-style-type: none; padding: 0;">${dobComplaintsReceived
                .map(
                  (c) =>
                    `<li style="margin-bottom: 10px;">Complaint #${c.complaint_number || 'N/A'} - Status: ${c.status || 'Unknown'} - Date Entered: ${c.date_entered || 'N/A'}</li>`,
                )
                .join('')}</ul>`
            : `<p style="font-style: italic; color: #999;">No DOB Complaints Received found.</p>`
        }
      </div>
  
      <!-- DOB Safety Violations -->
      <div style="background-color: #fff; padding: 15px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px;">
        <h3 style="color: #007bff; font-size: 18px; margin-top: 0;">DOB Safety Violations (${dobSafetyViolations.length})</h3>
        ${
          dobSafetyViolations.length > 0
            ? `<ul style="list-style-type: none; padding: 0;">${dobSafetyViolations
                .map(
                  (s) =>
                    `<li style="margin-bottom: 10px;">Violation #${s.violation_number || 'N/A'} - Type: ${s.violation_type || 'Unknown'} - Issue Date: ${s.violation_issue_date || 'N/A'}</li>`,
                )
                .join('')}</ul>`
            : `<p style="font-style: italic; color: #999;">No DOB Safety Violations found.</p>`
        }
      </div>
  
      <!-- Housing Maintenance Code Violations -->
      <div style="background-color: #fff; padding: 15px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px;">
        <h3 style="color: #007bff; font-size: 18px; margin-top: 0;">Housing Maintenance Code Violations (${housingMaintenanceCodeViolations.length})</h3>
        ${
          housingMaintenanceCodeViolations.length > 0
            ? `<ul style="list-style-type: none; padding: 0;">${housingMaintenanceCodeViolations
                .map(
                  (v) =>
                    `<li style="margin-bottom: 10px;">Violation ID: ${v.violationid || 'N/A'} - Status: ${v.violationstatus || 'Unknown'} - Inspection Date: ${v.inspectiondate || 'N/A'}</li>`,
                )
                .join('')}</ul>`
            : `<p style="font-style: italic; color: #999;">No Housing Maintenance Code Violations found.</p>`
        }
      </div>
  
      <!-- Housing Litigations -->
      <div style="background-color: #fff; padding: 15px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px;">
        <h3 style="color: #007bff; font-size: 18px; margin-top: 0;">Housing Litigations (${housingLitigations.length})</h3>
        ${
          housingLitigations.length > 0
            ? `<ul style="list-style-type: none; padding: 0;">${housingLitigations
                .map(
                  (l) =>
                    `<li style="margin-bottom: 10px;">Litigation ID: ${l.litigationid || 'N/A'} - Case Type: ${l.casetype || 'Unknown'} - Status: ${l.casestatus || 'Unknown'}</li>`,
                )
                .join('')}</ul>`
            : `<p style="font-style: italic; color: #999;">No Housing Litigations found.</p>`
        }
      </div>
  
      <!-- Order to Repair/Vacate Orders -->
      <div style="background-color: #fff; padding: 15px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px;">
        <h3 style="color: #007bff; font-size: 18px; margin-top: 0;">Order to Repair/Vacate Orders (${orderToRepairVacateOrders.length})</h3>
        ${
          orderToRepairVacateOrders.length > 0
            ? `<ul style="list-style-type: none; padding: 0;">${orderToRepairVacateOrders
                .map(
                  (o) =>
                    `<li style="margin-bottom: 10px;">Order Number: ${o.vacate_order_number || 'N/A'} - Vacate Type: ${o.vacate_type || 'N/A'} - Effective Date: ${o.vacate_effective_date || 'N/A'}</li>`,
                )
                .join('')}</ul>`
            : `<p style="font-style: italic; color: #999;">No Orders to Repair/Vacate found.</p>`
        }
      </div>
  
      <!-- Housing Maintenance Code Complaints and Problems -->
      <div style="background-color: #fff; padding: 15px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px;">
        <h3 style="color: #007bff; font-size: 18px; margin-top: 0;">Housing Maintenance Code Complaints and Problems (${housingMaintenanceCodeComplaintsAndProblems.length})</h3>
        ${
          housingMaintenanceCodeComplaintsAndProblems.length > 0
            ? `<ul style="list-style-type: none; padding: 0;">${housingMaintenanceCodeComplaintsAndProblems
                .map(
                  (p) =>
                    `<li style="margin-bottom: 10px;">Complaint #${p.complaint_id || 'N/A'} - Status: ${p.complaint_status || 'Unknown'} - Received: ${p.received_date || 'N/A'}</li>`,
                )
                .join('')}</ul>`
            : `<p style="font-style: italic; color: #999;">No Housing Maintenance Code Complaints and Problems found.</p>`
        }
      </div>
  
      <!-- Rodent Inspection Violations -->
      <div style="background-color: #fff; padding: 15px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px;">
        <h3 style="color: #007bff; font-size: 18px; margin-top: 0;">Rodent Inspection Violations (${rodentInspectionViolations.length})</h3>
        ${
          rodentInspectionViolations.length > 0
            ? `<ul style="list-style-type: none; padding: 0;">${rodentInspectionViolations
                .map(
                  (v) =>
                    `<li style="margin-bottom: 10px;">Job ID: ${v.job_id || 'N/A'} - Result: ${v.result || 'N/A'} - Inspection Date: ${v.inspection_date || 'N/A'}</li>`,
                )
                .join('')}</ul>`
            : `<p style="font-style: italic; color: #999;">No Rodent Inspection Violations found.</p>`
        }
      </div>
  
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="font-size: 12px; color: #999; text-align: center;">
        This email was automatically generated. If you have questions, please reply or contact support.
      </p>
    </div>
  `;
    const plainTextContent = `
NYC Building Violations Report

BIN: ${bin}

DOB ECB Violations (${dobEcbViolations.length})
${
  dobEcbViolations.length > 0
    ? dobEcbViolations
        .map(
          (v) =>
            `- Violation #${v.ecb_violation_number || 'N/A'} - Status: ${v.ecb_violation_status || 'Unknown'} - Issue Date: ${v.issue_date || 'N/A'} - Type: ${v.violation_type || 'N/A'}`,
        )
        .join('\n')
    : 'No DOB ECB Violations found.'
}

DOB Violations (${dobViolations.length})
${
  dobViolations.length > 0
    ? dobViolations
        .map(
          (v) =>
            `- Violation #${v.violation_number || 'N/A'} - Type: ${v.violation_type || 'Unknown'} - Issue Date: ${v.issue_date || 'N/A'}`,
        )
        .join('\n')
    : 'No DOB Violations found.'
}

DOB Complaints Received (${dobComplaintsReceived.length})
${
  dobComplaintsReceived.length > 0
    ? dobComplaintsReceived
        .map(
          (c) =>
            `- Complaint #${c.complaint_number || 'N/A'} - Status: ${c.status || 'Unknown'} - Date Entered: ${c.date_entered || 'N/A'}`,
        )
        .join('\n')
    : 'No DOB Complaints Received found.'
}

DOB Safety Violations (${dobSafetyViolations.length})
${
  dobSafetyViolations.length > 0
    ? dobSafetyViolations
        .map(
          (s) =>
            `- Violation #${s.violation_number || 'N/A'} - Type: ${s.violation_type || 'Unknown'} - Issue Date: ${s.violation_issue_date || 'N/A'}`,
        )
        .join('\n')
    : 'No DOB Safety Violations found.'
}

Housing Maintenance Code Violations (${housingMaintenanceCodeViolations.length})
${
  housingMaintenanceCodeViolations.length > 0
    ? housingMaintenanceCodeViolations
        .map(
          (v) =>
            `- Violation ID: ${v.violationid || 'N/A'} - Status: ${v.violationstatus || 'Unknown'} - Inspection Date: ${v.inspectiondate || 'N/A'}`,
        )
        .join('\n')
    : 'No Housing Maintenance Code Violations found.'
}

Housing Litigations (${housingLitigations.length})
${
  housingLitigations.length > 0
    ? housingLitigations
        .map(
          (l) =>
            `- Litigation ID: ${l.litigationid || 'N/A'} - Case Type: ${l.casetype || 'Unknown'} - Status: ${l.casestatus || 'Unknown'}`,
        )
        .join('\n')
    : 'No Housing Litigations found.'
}

Order to Repair/Vacate Orders (${orderToRepairVacateOrders.length})
${
  orderToRepairVacateOrders.length > 0
    ? orderToRepairVacateOrders
        .map(
          (o) =>
            `- Order Number: ${o.vacate_order_number || 'N/A'} - Vacate Type: ${o.vacate_type || 'N/A'} - Effective Date: ${o.vacate_effective_date || 'N/A'}`,
        )
        .join('\n')
    : 'No Orders to Repair/Vacate found.'
}

Housing Maintenance Code Complaints and Problems (${housingMaintenanceCodeComplaintsAndProblems.length})
${
  housingMaintenanceCodeComplaintsAndProblems.length > 0
    ? housingMaintenanceCodeComplaintsAndProblems
        .map(
          (p) =>
            `- Complaint #${p.complaint_id || 'N/A'} - Status: ${p.complaint_status || 'Unknown'} - Received: ${p.received_date || 'N/A'}`,
        )
        .join('\n')
    : 'No Housing Maintenance Code Complaints and Problems found.'
}

Rodent Inspection Violations (${rodentInspectionViolations.length})
${
  rodentInspectionViolations.length > 0
    ? rodentInspectionViolations
        .map(
          (v) =>
            `- Job ID: ${v.job_id || 'N/A'} - Result: ${v.result || 'N/A'} - Inspection Date: ${v.inspection_date || 'N/A'}`,
        )
        .join('\n')
    : 'No Rodent Inspection Violations found.'
}

---
This email was automatically generated. If you have questions, please reply or contact support.
`;
    return { htmlContent, plainTextContent };
  }
}
