#!/bin/bash

# Exit on any error
set -e

# Load environment variables from .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo "Error: .env file not found"
  exit 1
fi

# Check for required environment variables
if [ -z "$GCP_PROJECT_ID" ]; then
  echo "Error: GCP_PROJECT_ID environment variable is required"
  exit 1
fi

if [ -z "$GCP_LOCATION" ]; then
  echo "Using default location: us-central1"
  GCP_LOCATION="us-central1"
fi

if [ -z "$CLOUD_TASKS_QUEUE_NAME" ]; then
  echo "Using default queue name: bins-processing-queue"
  CLOUD_TASKS_QUEUE_NAME="bins-processing-queue"
fi

echo "Creating Cloud Tasks queue in project $GCP_PROJECT_ID"
echo "Location: $GCP_LOCATION"
echo "Queue name: $CLOUD_TASKS_QUEUE_NAME"

# Create the Cloud Tasks queue
gcloud tasks queues create $CLOUD_TASKS_QUEUE_NAME \
  --location=$GCP_LOCATION \
  --project=$GCP_PROJECT_ID \
  --max-concurrent-dispatches=100 \
  --max-dispatches-per-second=500 \
  --max-attempts=5 \
  --min-backoff=1s

echo "Cloud Tasks queue created successfully"

# Create a service account for Cloud Tasks if it doesn't exist
if [ -z "$CLOUD_TASKS_SERVICE_ACCOUNT" ]; then
  SERVICE_ACCOUNT_NAME="cloud-tasks-sa"
  echo "Creating service account: $SERVICE_ACCOUNT_NAME"
  
  gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME \
    --project=$GCP_PROJECT_ID \
    --display-name="Cloud Tasks Service Account"
    
  CLOUD_TASKS_SERVICE_ACCOUNT="${SERVICE_ACCOUNT_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
  echo "Service account created: $CLOUD_TASKS_SERVICE_ACCOUNT"
  
  # Add this to .env file
  if grep -q "CLOUD_TASKS_SERVICE_ACCOUNT=" .env; then
    sed -i '' "s|CLOUD_TASKS_SERVICE_ACCOUNT=.*|CLOUD_TASKS_SERVICE_ACCOUNT=$CLOUD_TASKS_SERVICE_ACCOUNT|g" .env
  else
    echo "CLOUD_TASKS_SERVICE_ACCOUNT=$CLOUD_TASKS_SERVICE_ACCOUNT" >> .env
  fi
else
  echo "Using existing service account: $CLOUD_TASKS_SERVICE_ACCOUNT"
fi

# Grant the Cloud Tasks service account the required roles
echo "Granting Cloud Tasks service account the required permissions"

# Grant Cloud Tasks Service Agent role
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:$CLOUD_TASKS_SERVICE_ACCOUNT" \
  --role="roles/cloudtasks.serviceAgent"

# Grant permission to invoke Cloud Run or App Engine services (adjust as needed)
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:$CLOUD_TASKS_SERVICE_ACCOUNT" \
  --role="roles/run.invoker"

echo "Setup completed successfully"
echo ""
echo "Next steps:"
echo "1. Make sure to set the SERVICE_URL environment variable in your .env file"
echo "2. Deploy your application to Cloud Run or App Engine"
echo "3. Add the following IAM role to your service account: roles/cloudtasks.enqueuer" 