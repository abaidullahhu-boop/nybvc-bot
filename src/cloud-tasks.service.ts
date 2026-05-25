// @ts-ignore — package is installed during the Docker build via package.json;
// local node_modules may not have the types resolved during agent edits.
import { CloudTasksClient } from '@google-cloud/tasks';
import { DiagnosticNote } from './contact-extraction.types';

/**
 * Payload accepted by the /scrape-bin endpoint. Cloud Tasks dispatches one of
 * these per BIN so the per-BIN scrape stays well under Cloud Run's 60-minute
 * request timeout.
 */
export interface ScrapeBinTaskPayload {
  bin: string;
  rowIndex: number;
  sheetName: string;
  priorNotes: DiagnosticNote[];
}

/**
 * Thin wrapper over Google Cloud Tasks. The Cloud Run service that runs this
 * code acts as the *enqueuer*; the queue then dispatches HTTP requests to
 * ${SERVICE_URL}/scrape-bin one-at-a-time (configured via the queue's
 * max-concurrent-dispatches and max-dispatches-per-second), which gives us
 * the Akamai-friendly pacing for free without any in-process setTimeout.
 *
 * Configuration via env vars (already wired in the deploy workflow):
 *   GCP_PROJECT_ID, GCP_LOCATION, CLOUD_TASKS_QUEUE_NAME,
 *   CLOUD_TASKS_SERVICE_ACCOUNT (for OIDC), SERVICE_URL
 */
export class CloudTasksService {
  // @ts-ignore — runtime type comes from @google-cloud/tasks
  private readonly client: CloudTasksClient | null = null;
  private readonly projectId: string;
  private readonly location: string;
  private readonly queueName: string;
  private readonly serviceAccountEmail: string;
  private readonly serviceUrl: string;
  private readonly configured: boolean;

  constructor() {
    this.projectId = (process.env.GCP_PROJECT_ID || '').trim();
    this.location = (process.env.GCP_LOCATION || '').trim();
    this.queueName = (process.env.CLOUD_TASKS_QUEUE_NAME || '').trim();
    this.serviceAccountEmail = (
      process.env.CLOUD_TASKS_SERVICE_ACCOUNT || ''
    ).trim();
    this.serviceUrl = (process.env.SERVICE_URL || '').trim();

    this.configured = !!(
      this.projectId &&
      this.location &&
      this.queueName &&
      this.serviceUrl
    );

    if (this.configured) {
      try {
        this.client = new CloudTasksClient();
        console.log(
          `CloudTasksService configured: projectId=${this.projectId}, location=${this.location}, queue=${this.queueName}, target=${this.serviceUrl}, oidcSA=${this.serviceAccountEmail || '(none)'}`,
        );
      } catch (err) {
        console.error('CloudTasksClient init failed:', err);
        this.client = null;
      }
    } else {
      console.log(
        `CloudTasksService disabled (missing one of GCP_PROJECT_ID/GCP_LOCATION/CLOUD_TASKS_QUEUE_NAME/SERVICE_URL). Phase 3 will fall back to in-process scraping.`,
      );
    }
  }

  isConfigured(): boolean {
    return this.configured && !!this.client;
  }

  /**
   * Enqueue a Cloud Task that will POST the given ScrapeBinTaskPayload to
   * `${SERVICE_URL}/scrape-bin`. The endpoint runs that single BIN's BIS +
   * DOB NOW scrape and writes columns E:H. Returns the created task name.
   */
  async createScrapeBinTask(payload: ScrapeBinTaskPayload): Promise<string | null> {
    if (!this.isConfigured() || !this.client) {
      console.warn(
        `createScrapeBinTask called but CloudTasksService not configured; skipping BIN ${payload.bin}`,
      );
      return null;
    }

    const parent = this.client.queuePath(
      this.projectId,
      this.location,
      this.queueName,
    );

    const url = `${this.serviceUrl}/scrape-bin`;
    const body = Buffer.from(JSON.stringify(payload)).toString('base64');

    const task: any = {
      httpRequest: {
        httpMethod: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      },
      // Cloud Run service has --timeout 3600; each per-BIN scrape comfortably
      // fits, so we don't need to shorten the dispatch deadline.
    };

    if (this.serviceAccountEmail) {
      task.httpRequest.oidcToken = {
        serviceAccountEmail: this.serviceAccountEmail,
        audience: this.serviceUrl,
      };
    }

    try {
      const [response] = await this.client.createTask({ parent, task });
      const name = (response.name as string) || '(unnamed)';
      console.log(`Enqueued scrape task for BIN ${payload.bin}: ${name}`);
      return name;
    } catch (err) {
      console.error(`Failed to enqueue scrape task for BIN ${payload.bin}:`, err);
      throw err;
    }
  }
}
