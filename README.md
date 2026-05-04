 Lead Gen Platform
An automated growth engine designed to identify, qualify, and engage high-value prospects. This platform centralizes the lead lifecycle from initial scraping to automated pipeline management.

⚡ Core Superpowers
1. Intelligent Lead Scoring
The system processes raw data through a proprietary qualification layer to ensure sales efforts are focused on the highest-probability targets.

Automated Discovery: Utilizing the test-scraper.mjs engine to pull real-time data from business directories and targeted sources.

Qualification Logic: Leads are stored in leads.db and evaluated against specific industry benchmarks (revenue, headcount, and growth signals) defined in the docs/superpowers/plans directory.

Data Integrity: Integrated with Sentry to monitor ingestion health and prevent low-quality or malformed data from entering the pipeline.

2. Dynamic Email Outreach
The platform automates the creation of personalized, high-conversion correspondence.

Variable Injection: Uses shell-based token expansion (as seen in the weekly-report.sh logic) to inject lead-specific data into outreach templates.

Contextual Writing: Leverages TypeScript 6 for strong typing of lead attributes, ensuring that every generated email is technically accurate and personalized to the recipient's industry.

Automated Reporting: A weekly summary is triggered via the $REPORT_TOKEN variable to track email performance and engagement metrics.

3. Pipeline Automation
The entire lead lifecycle is managed via a hands-off, serverless infrastructure.

Continuous Flow: Deployed on Railway, the platform runs 24/7. As new leads are scraped and scored, they are automatically moved through the funnel.

Scheduled Workflows: Managed via cron-railway.json, the system triggers weekly reporting and pipeline audits without manual intervention.

Database Separation: * leads.db: Dedicated to high-volume prospect storage and initial scoring.

paradise.db: The core application database for qualified, high-intent opportunities.

🛠 Tech Stack
Language: TypeScript 6

Framework: Next.js

Infrastructure: Railway

Database: SQLite (Local/Persistent)

Monitoring: Sentry

Testing: Vitest
