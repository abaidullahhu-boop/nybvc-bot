# Google Cloud Tasks Integration

This project has been configured to use Google Cloud Tasks for reliable, asynchronous task processing. Cloud Tasks provides a more robust solution compared to direct HTTP calls and ensures that tasks are executed reliably, even in the face of temporary failures.

## How It Works

1. The `/trigger` endpoint now creates Cloud Tasks instead of making direct HTTP calls
2. Each batch of BINs to process is sent as a separate task to the `/process-bins` endpoint
3. The Project 2 execution is also sent as a separate task to the `/run-project2` endpoint
4. Cloud Tasks handles retries, rate limiting, and delivery guarantees

## Setup Instructions

### Prerequisites

1. A Google Cloud Platform project with billing enabled
2. The `gcloud` CLI installed and configured for your project
3. Appropriate permissions to create Cloud Tasks queues and IAM roles

### Environment Variables

Add the following environment variables to your `.env` file:

```
# Google Cloud Tasks
GCP_PROJECT_ID=your-gcp-project-id
GCP_LOCATION=us-central1
CLOUD_TASKS_QUEUE_NAME=bins-processing-queue
CLOUD_TASKS_SERVICE_ACCOUNT=your-service-account@your-project.iam.gserviceaccount.com
SERVICE_URL=https://your-service-url.com
```

### Creating the Cloud Tasks Queue

You can use the provided script to create the Cloud Tasks queue and set up the necessary permissions:

```bash
./setup-cloud-tasks.sh
```

This script will:

1. Create a Cloud Tasks queue with the name specified in your `.env` file
2. Create a service account for Cloud Tasks if one isn't already specified
3. Grant the necessary permissions to the service account

Alternatively, you can create the queue manually with this command:

```bash
gcloud tasks queues create bins-processing-queue \
  --location=us-central1 \
  --project=your-gcp-project-id \
  --max-concurrent-dispatches=100 \
  --max-dispatches-per-second=500 \
  --max-attempts=5 \
  --min-backoff=1s
```

### Deployment

When deploying your application, make sure that the service account running your application has the `roles/cloudtasks.enqueuer` role, which allows it to create tasks in the Cloud Tasks queue.

If deploying to Cloud Run, you can add this role with:

```bash
gcloud projects add-iam-policy-binding your-gcp-project-id \
  --member="serviceAccount:your-app-service-account@your-project.iam.gserviceaccount.com" \
  --role="roles/cloudtasks.enqueuer"
```

Additionally, the service account used by Cloud Tasks needs permission to invoke your service. If using Cloud Run, grant the `run.invoker` role:

```bash
gcloud run services add-iam-policy-binding your-service-name \
  --member="serviceAccount:your-tasks-service-account@your-project.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=your-region \
  --project=your-gcp-project-id
```

## Monitoring

You can monitor your Cloud Tasks queue in the Google Cloud Console under **Cloud Tasks**. This shows task status, error rates, and allows you to purge or pause the queue if needed.

## Troubleshooting

If tasks are failing to execute, check:

1. That the `SERVICE_URL` is correct and your service is accessible
2. That the service account has the correct permissions
3. That your application is correctly handling the task requests
4. The Cloud Tasks logs in Cloud Logging for detailed error information

