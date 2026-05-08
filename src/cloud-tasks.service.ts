// import { CloudTasksClient } from '@google-cloud/tasks';
// import * as dotenv from 'dotenv';

// dotenv.config();

// export class CloudTasksService {
//   private client: CloudTasksClient;
//   private projectId: string;
//   private location: string;
//   private queueName: string;
//   private serviceAccountEmail: string;
//   private serviceUrl: string;

//   constructor() {
//     this.client = new CloudTasksClient();
//     this.projectId = process.env.GCP_PROJECT_ID || '';
//     this.location = process.env.GCP_LOCATION || 'us-central1';
//     this.queueName =
//       process.env.CLOUD_TASKS_QUEUE_NAME || 'bins-processing-queue';
//     this.serviceAccountEmail = process.env.CLOUD_TASKS_SERVICE_ACCOUNT || '';
//     this.serviceUrl = process.env.SERVICE_URL || '';

//     if (!this.projectId) {
//       throw new Error('GCP_PROJECT_ID environment variable is required');
//     }

//     if (!this.serviceUrl) {
//       throw new Error('SERVICE_URL environment variable is required');
//     }
//   }

//   /**
//    * Creates a task to process a batch of BINs
//    * @param bins Array of BIN numbers to process
//    * @param endpoint The endpoint to call (default: '/process-bins')
//    * @returns The created task name
//    */
//   async createProcessBinsTask(
//     bins: string[],
//     endpoint: string = '/process-bins',
//     sheetDate?: string,
//   ): Promise<string> {
//     const parent = this.client.queuePath(
//       this.projectId,
//       this.location,
//       this.queueName,
//     );

//     // Construct the request body
//     const url = `${this.serviceUrl}${endpoint}`;
//     const payload: any = { bins };
//     if (sheetDate) {
//       payload.sheetDate = sheetDate;
//     }

//     // Create task with OIDC token for authentication
//     const task: any = {
//       httpRequest: {
//         httpMethod: 'POST',
//         url,
//         headers: {
//           'Content-Type': 'application/json',
//         },
//         body: Buffer.from(JSON.stringify(payload)).toString('base64'),
//       },
//     };

//     // Add OIDC token if service account is provided
//     if (this.serviceAccountEmail) {
//       task.httpRequest.oidcToken = {
//         serviceAccountEmail: this.serviceAccountEmail,
//         audience: url,
//       };
//     }

//     // Send create task request
//     const [response] = await this.client.createTask({
//       parent,
//       task,
//     });

//     console.log(`Created task: ${response.name}`);
//     return response.name as string;
//   }

//   /**
//    * Creates a task to run Project 2
//    * @returns The created task name
//    */
//   async createRunProject2Task(): Promise<string> {
//     return this.createProcessBinsTask([], '/run-project2');
//   }
// }
