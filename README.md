# NYC Properties Bot

A NestJS-based automation system that collects, processes, and manages NYC property data. The bot integrates multiple data sources and services to provide comprehensive property information and automated workflows.

## Features

- **DOB Data Scraping**: Automated collection of Department of Buildings data using Playwright
- **NYC Open Data Integration**: Direct integration with NYC Open Data APIs
- **AI-Powered Analysis**: Utilizes Google's Generative AI for intelligent data processing
- **PDF Processing**: Extracts and processes information from PDF documents
- **Automated Communications**: Email automation using Resend
- **Scheduled Tasks**: Automated data collection and processing using scheduling

## Tech Stack

- **Framework**: TypeScript
- **Runtime**: Node.js (>= 18)
- **Key Dependencies**:
  - Playwright for web scraping
  - Google Generative AI (Gemini)
  - PDF-parse for document processing
  - Cheerio for HTML parsing
  - Resend for email services
  - Axios for HTTP requests
  - RxJS for reactive programming
  - ESLint and Prettier for code quality

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/yourusername/nyc-properties-bot.git
cd nyc-properties-bot
```

2. Install dependencies:

```bash
bun install
```

3. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Run the application:

```bash
npm start
```

## Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

- NYC Open Data API credentials
- Gemini API key
- Resend API key
- Other service-specific configurations

## Available Scripts

- `npm start` - Start the application

## Deployment

This application can be deployed to Google Cloud Run. For detailed deployment instructions, see [DEPLOY.md](DEPLOY.md).

Key deployment features:

- Docker containerization
- Google Cloud Run managed platform
- Automated scheduling with Cloud Scheduler
- Environment variable management
- Memory and timeout configuration
- Monitoring and logging integration

Prerequisites for deployment:

1. Google Cloud SDK
2. Docker
3. Google Cloud account and project
4. Required API credentials

## Requirements

- Node.js >= 18
- npm >= 9

## License

This project is private and unlicensed.
