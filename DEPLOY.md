# Deploying to Google Cloud Run

This guide explains how to deploy the NYC Properties Bot to Google Cloud Run.

## Prerequisites

1. Install the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
2. Install [Docker](https://docs.docker.com/get-docker/)
3. Have a Google Cloud account and project

## Setup

1. Authenticate with Google Cloud:

```bash
gcloud auth login
```

1. Set your project:

```bash
gcloud config set project ny-building-bot-496807
```

1. Configure Docker to use the Google Artifact Registry:

```bash
gcloud auth configure-docker us-east1-docker.pkg.dev
```

1. Enable required APIs:

```bash
# Enable Cloud Run API
gcloud services enable run.googleapis.com

# Enable Artifact Registry API
gcloud services enable artifactregistry.googleapis.com

# Enable Cloud Build API
gcloud services enable cloudbuild.googleapis.com

# Enable Cloud Scheduler API
gcloud services enable cloudscheduler.googleapis.com
```

1. Create an Artifact Registry repository:

```bash
gcloud artifacts repositories create nyc-building-bot --repository-format=docker --location=us-east1 --description="Docker repository for NYC Building Bot"
```

## Environment Variables

Create a `.env.yaml` file with your configuration:

```yaml
SOCRATA_APP_TOKEN: 'your-socrata-token'
RESEND_API_KEY: 'your-resend-api-key'
FROM_EMAIL: 'your-from-email'
GOOGLE_AI_API_KEY: 'your-gemini-api-key'
GOOGLE_SHEET_CREDENTIALS_PATH: 'path/to/your/google-sheet-credentials.json'
GOOGLE_DATASTORE_CREDENTIALS_PATH: 'path/to/your/google-datastore-credentials.json'
PROJECT1_GOOGLE_SHEET_ID: 'your-google-sheet-id'
PROJECT2_GOOGLE_SHEET_ID: 'your-google-sheet-id'
PROJECT2_GOOGLE_SHEET_NAME: 'your-google-sheet-name'
```

## Build & Deploy

1. Build and tag the Docker image:

```bash
docker build -t us-east1-docker.pkg.dev/ny-building-bot-496807/nyc-building-bot/app:latest .
```

1. Push the image to Google Artifact Registry:

```bash
docker push us-east1-docker.pkg.dev/ny-building-bot-496807/nyc-building-bot/app:latest
```

1. Deploy to Cloud Run:

```bash
gcloud run deploy nyc-building-bot --image us-east1-docker.pkg.dev/ny-building-bot-496807/nyc-building-bot/app:latest --region us-east1 --platform managed --memory 4Gi --timeout 3600 --env-vars-file .env.yaml --no-allow-unauthenticated --min-instances 0 --max-instances 1 --cpu-throttling
```

1. Get the Cloud Run service URL:

```bash
gcloud run services describe nyc-building-bot --region us-east1 --format="value(status.url)"
```

1. Create a service account for the scheduler:

```bash
gcloud iam service-accounts create cloud-run-scheduler --display-name="Cloud Run Scheduler"

gcloud projects add-iam-policy-binding ny-building-bot-496807 --member="serviceAccount:cloud-run-scheduler@ny-building-bot-496807.iam.gserviceaccount.com" --role="roles/run.invoker"
```

1. Create a Cloud Scheduler job to trigger the service daily at 10 AM NYC time:

```bash
gcloud scheduler jobs create http daily-tasks --schedule="30 7 * * *" --uri="URL_OF_CLOUD_RUN_SERVICE" --http-method=POST --time-zone="America/New_York" --location=us-east1 --oidc-service-account-email="cloud-run-scheduler@ny-building-bot-496807.iam.gserviceaccount.com"
```

## Deployment Options Explained

- `--memory=4Gi`: Allocate 4GB of memory
- `--timeout=3600`: Maximum execution time (1 hour)
- `--platform=managed`: Use fully managed Cloud Run platform
- `--no-allow-unauthenticated`: Require authentication for invocations
- `--min-instances=0`: Minimum number of instances to keep running (0 for autoscaling)
- `--max-instances=1`: Maximum number of instances to keep running (1 for autoscaling)
- `--cpu-throttling`: Enable CPU throttling
- `--env-vars-file=.env.yaml`: Use environment variables from .env.yaml file

## Monitoring & Logs

1. View service logs:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=nyc-building-bot"
```

1. View service details:

```bash
gcloud run services describe nyc-building-bot --region us-east1
```

1. View service metrics in the Cloud Console:
  - Go to Cloud Run in the Google Cloud Console
  - Select your service
  - Click on "Metrics" tab

## Troubleshooting

1. If deployment fails:
  - Check the build logs
  - Verify Docker build succeeds locally
  - Ensure all required APIs are enabled
  - Check if service account has necessary permissions
2. If service fails:
  - Check service logs for errors
  - Verify environment variables are set correctly
  - Check if memory/timeout limits are sufficient
  - Verify Docker container starts successfully locally
3. If scheduling fails:
  - Verify Cloud Scheduler job is in the same region as the service
  - Check if service account has invoker permissions
  - Ensure the service URL is correct

## Updating the Service

To update the deployed service with new code:

1. Make your changes
2. Build and tag a new Docker image:

```bash
docker build -t us-east1-docker.pkg.dev/ny-building-bot-496807/nyc-building-bot/app:latest .
```

1. Push the new image:

```bash
docker push us-east1-docker.pkg.dev/ny-building-bot-496807/nyc-building-bot/app:latest
```

1. Deploy the new version:

```bash
gcloud run deploy nyc-building-bot \
  --image us-east1-docker.pkg.dev/ny-building-bot-496807/nyc-building-bot/app:latest \
  --region us-east1
```

The new version will be deployed without changing the scheduler configuration.