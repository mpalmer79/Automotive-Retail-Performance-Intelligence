# Automotive Dealership Data Analytics Portfolio Research

**Prepared for:** Michael Palmer  
**Document purpose:** Evidence base for the `ARCHITECTURE.md` specification  
**Primary career targets:** Data Analyst, Business Intelligence Analyst, Automotive Data Analyst, Sales Operations Analyst, Product Analyst, Revenue Operations Analyst, and Reporting Analyst  
**Project status:** Research complete, architecture ready for implementation planning  

---

## Executive Summary

Michael should build a **hybrid automotive dealership analytics portfolio project whose primary deliverable is a Power BI dashboard backed by PostgreSQL**, with Python supporting synthetic data generation, validation, transformation, and reproducible analysis.

A lightweight public-facing case study may be added after the core analytics work is complete, but it should not become the central product. The project must demonstrate analytical credibility first and software engineering second.

The recommended project positioning is:

> A dealership performance intelligence platform that integrates sales, inventory, lead, finance and insurance, marketing, service, and retention data to help dealership leaders identify profit leakage, inventory risk, conversion bottlenecks, and operational opportunities.

The strongest version of the project will demonstrate five capabilities:

1. Translating dealership business problems into measurable analytical requirements
2. Modeling realistic dealership data in a dimensional warehouse
3. Using SQL and Python for transformation, validation, and reproducibility
4. Using Power BI for decision-oriented reporting and executive communication
5. Converting analysis into documented management recommendations

This direction fits Michael particularly well because it combines more than 25 years of dealership experience with SQL, databases, statistics, software development, AI tooling, and business communication.

---

## Table of Contents

1. [Research Objectives](#1-research-objectives)
2. [Current Employer Expectations](#2-current-employer-expectations)
3. [Technical Skill Priorities](#3-technical-skill-priorities)
4. [Automotive Dealership KPIs and Use Cases](#4-automotive-dealership-kpis-and-use-cases)
5. [Dataset Strategy](#5-dataset-strategy)
6. [Technical Architecture Comparison](#6-technical-architecture-comparison)
7. [Core Deliverable Decision](#7-core-deliverable-decision)
8. [What Distinguishes a Strong Portfolio Project](#8-what-distinguishes-a-strong-portfolio-project)
9. [Recommended Project Scope](#9-recommended-project-scope)
10. [Privacy, Legal, Ethical, and Security Considerations](#10-privacy-legal-ethical-and-security-considerations)
11. [Final Project Recommendation](#11-final-project-recommendation)
12. [Inputs Required for Architecture](#12-inputs-required-for-architecture)
13. [Final Conclusion](#13-final-conclusion)
14. [Source Notes](#14-source-notes)

---

# 1. Research Objectives

This report evaluates the market, technical, domain, and portfolio requirements for a professional automotive dealership analytics project.

The project must support applications for the following role families:

- Data Analyst
- Business Intelligence Analyst
- Automotive Data Analyst
- Sales Operations Analyst
- Revenue Operations Analyst
- Product Analyst
- Reporting Analyst

The research focuses on ten questions:

1. What do current employers expect from entry-level and mid-level analysts?
2. Which technical skills appear most consistently in job descriptions?
3. Which dealership KPIs are operationally meaningful?
4. Which public or synthetic datasets can support the project?
5. Which technical architecture is most appropriate?
6. What should the core deliverable be?
7. What separates professional portfolio work from classroom work?
8. What scope is realistic and defensible?
9. What privacy, legal, ethical, and security constraints apply?
10. What decisions must be fixed before implementation begins?

The report separates market evidence, automotive-domain reasoning, and project recommendations wherever practical.

---

# 2. Current Employer Expectations

## 2.1 Cross-Role Expectations

Current Data Analyst, Business Intelligence, Sales Operations, Revenue Operations, and automotive analytics roles consistently expect more than dashboard creation.

Employers typically expect analysts to:

- Retrieve data from relational databases
- Clean, normalize, and reconcile data from multiple sources
- Create repeatable reports and dashboards
- Define, document, and monitor KPIs
- Validate data accuracy and investigate discrepancies
- Explain findings to nontechnical stakeholders
- Identify business problems and recommend actions
- Collaborate with operations, sales, finance, product, and leadership teams
- Maintain metric definitions, report logic, and documentation
- Support forecasting, planning, and operational decision-making

Business Intelligence roles commonly combine SQL with Power BI or Tableau, dimensional modeling, data integration, validation, and stakeholder collaboration.

Sales Operations and Revenue Operations roles usually extend beyond reporting. They often include:

- CRM governance
- Forecasting and pipeline reporting
- Lifecycle-stage management
- Data hygiene
- Territory analysis
- Quota analysis
- Process optimization
- Executive scorecards
- Cross-functional reporting
- Integration maintenance

Automotive analytics roles commonly request:

- SQL
- Python
- Visualization tools
- Statistical analysis
- Pricing analysis
- Sell-through analysis
- Margin analysis
- Inventory analysis
- Market share analysis
- Automotive-domain knowledge
- Executive recommendations

## 2.2 Entry-Level Expectations

A credible entry-level candidate is generally expected to demonstrate:

- SQL beyond basic `SELECT` statements
- Advanced Excel capability
- At least one visualization platform
- Data-cleaning competence
- Basic statistics
- Ability to interpret business requirements
- Clear written and verbal communication
- Practical evidence of completed analysis

The term **entry level** is frequently misleading. Many postings still request one to three years of analytics, finance, operations, or reporting exposure.

This creates an important portfolio requirement:

> The project must look like simulated professional work, not a guided classroom exercise.

Michael should not position himself as a candidate with no relevant experience. His automotive leadership, operational reporting, customer lifecycle knowledge, dealership finance experience, and technical retraining provide substantial business context.

## 2.3 Mid-Level Expectations

Mid-level candidates are more often expected to:

- Own a reporting area
- Design semantic or dimensional data models
- Manage data pipelines
- Improve report reliability and performance
- Gather stakeholder requirements
- Create reusable measures
- Conduct root-cause analysis
- Present recommendations to leadership
- Establish data definitions and governance controls
- Resolve discrepancies between systems
- Document data lineage and business logic

Michael should build the project above the minimum entry-level threshold. His domain expertise can support a mid-level business-facing analyst narrative even while his formal analytics title is new.

## 2.4 Implications for Positioning

Michael's strongest market positioning is not:

> Entry-level analyst seeking first exposure to business data.

A stronger and more accurate positioning is:

> Automotive operations and technology professional transitioning into analytics, with more than 25 years of dealership-domain expertise and current hands-on experience in SQL, databases, Python, dashboards, APIs, and software development.

This framing matters because the project should prove that Michael can connect data to dealership decisions that a generalist junior analyst may not understand.

---

# 3. Technical Skill Priorities

## 3.1 Priority Matrix

| Skill | Priority | Project Role |
|---|---:|---|
| SQL | Essential | Data retrieval, transformation, KPI logic, validation |
| Excel | Essential | Operational reporting, reconciliation, management exports |
| Power BI | Essential | Semantic model, DAX, dashboards, executive reporting |
| Business communication | Essential | Findings, recommendations, stakeholder framing |
| Data modeling | Essential | Fact tables, dimensions, grain, relationships |
| ETL or ELT | Essential | Reproducible source-to-report flow |
| Python and pandas | Strong differentiator | Synthetic generation, validation, exploratory analysis |
| Statistics | Strong differentiator | Trend, variance, conversion, cohort, and distribution analysis |
| Cloud database | Useful | Hosted PostgreSQL and portfolio accessibility |
| Tableau | Optional | Not recommended for version one |
| FastAPI | Optional | Advanced extension only |
| React or Next.js | Optional | Public case study only |
| Machine learning | Deferred | Use only when a validated business need exists |

---

## 3.2 SQL

SQL is the most important technical capability for this project.

The portfolio should demonstrate:

- Inner, left, and controlled outer joins
- Aggregation
- Common table expressions
- Window functions
- Conditional logic
- Date calculations
- Subqueries
- Views
- Materialized views where justified
- Data-quality queries
- KPI calculations
- Ranking and segmentation
- Query organization
- Query documentation
- Index-aware design
- Reconciliation logic

The project should not bury all business logic inside Power BI. Important calculations should be visible either in SQL reporting views or in clearly documented DAX measures.

## 3.3 Excel

Excel remains especially important for Sales Operations, Revenue Operations, Reporting Analyst, and dealership-oriented roles.

The project should include a concise Excel deliverable demonstrating:

- Pivot tables
- XLOOKUP or equivalent lookup logic
- `SUMIFS`
- `COUNTIFS`
- Date functions
- Conditional formatting
- Power Query
- Reconciliation
- Executive summary reporting
- Variance tracking

Excel should support the project, not replace the database or semantic model.

## 3.4 Power BI

Power BI is the strongest primary dashboard platform for this project because it demonstrates:

- Data modeling
- Power Query
- DAX
- KPI development
- Filter context
- Drill-through reporting
- Executive dashboard design
- Operational scorecards
- Enterprise-style reporting
- Row-level security concepts, if added later
- Model documentation

The project should use a star or fact-constellation model rather than connecting Power BI directly to a single flat CSV.

## 3.5 Business Communication

Communication is not secondary. The project must show that Michael can convert analysis into a management decision.

Each dashboard page should answer:

1. What happened?
2. Why did it happen?
3. Where is the problem concentrated?
4. What financial or operational impact does it create?
5. What action should management consider?

The portfolio must include an executive findings memo. Charts without interpretation are insufficient.

## 3.6 Python and pandas

Python should support the analytics workflow rather than become the visible centerpiece.

Recommended uses:

- Synthetic dealership data generation
- Data cleaning
- Referential-integrity validation
- Outlier identification
- Reproducible transformation
- Exploratory analysis
- Statistical checks
- Automated quality reports
- Seed-controlled generation
- Scenario-based data creation

Python logic should be modular and testable. The project should avoid placing all work in one notebook.

## 3.7 Data Modeling

Data modeling is essential for distinguishing the project from classroom dashboard work.

The project should include:

- Fact tables
- Dimension tables
- Defined grain
- Conformed dimensions
- Surrogate keys
- Date dimension
- Role-playing dates where necessary
- Documented relationships
- Slowly changing dimension decisions
- Business definitions for measures
- Source-to-target mappings

The fact-table grain must be explicitly documented before implementation.

## 3.8 ETL or ELT

The project should demonstrate a reproducible data flow:

1. Public reference sources and synthetic source generation
2. Raw staging layer
3. Validation
4. Transformation
5. Dimensional warehouse tables
6. Reporting views
7. Power BI semantic model
8. Published analytical outputs

A collection of manually edited CSV files would be too weak and difficult to audit.

## 3.9 Statistics

The project should demonstrate practical statistics rather than advanced machine learning.

Appropriate examples include:

- Conversion-rate comparison
- Variance analysis
- Moving averages
- Cohort analysis
- Trend analysis
- Price and gross-profit distributions
- Correlation with explicit warnings against causal interpretation
- Confidence intervals where meaningful
- Median versus mean comparisons
- Outlier review
- Seasonality checks

## 3.10 Skills to Deprioritize

The following skills may be useful later but should not control version one:

- Tableau
- FastAPI
- Streamlit
- React dashboards
- Next.js dashboards
- Machine learning
- AI assistants
- Data streaming
- Distributed processing
- Complex cloud orchestration

The project exists to prove analytics capability, not to maximize the number of technologies used.

---

# 4. Automotive Dealership KPIs and Use Cases

# 4.1 Vehicle Sales Performance

## Required Measures

- Vehicles retailed
- New vehicles sold
- Used vehicles sold
- Certified pre-owned vehicles sold
- Retail versus wholesale units
- Units by day, week, month, and quarter
- Units by salesperson
- Units by dealership
- Units by make, model, trim, body style, and model year
- Units by source
- Month-over-month change
- Year-over-year change
- Pace against target
- Retail delivery rate
- Department mix

## Primary Questions

- Which departments and employees are ahead of pace?
- Which models are producing volume without profit?
- Where are sales declining?
- Are new and used departments moving in opposite directions?
- Is volume concentrated in too few models or employees?
- Which stores are missing target?
- Which sources generate the most completed retail sales?

---

# 4.2 Front-End and Back-End Gross Profit

## Required Measures

- Front-end gross
- Back-end gross
- Total gross
- Front gross per retail unit
- Back gross per retail unit
- Total gross per retail unit
- Gross by salesperson
- Gross by finance manager
- Gross by model
- Gross by lead source
- Gross by age bucket
- Negative-front deals
- Low-gross deals
- Discount as a percentage of asking price
- Discount as a percentage of MSRP
- Gross variance against target
- Gross distribution

## Modeling Rule

Front-end gross, back-end gross, and total gross must remain separate. Combining them too early prevents useful diagnosis.

## Primary Questions

- Is volume being purchased through excessive discounts?
- Which models produce weak front gross but strong F&I?
- Which salespeople retain gross?
- Which aged vehicles generate acceptable loss relative to holding risk?
- Are acquisition source and reconditioning cost affecting used-car gross?
- Are certain stores over-reliant on back-end gross?

---

# 4.3 Inventory Aging

## Required Age Buckets

- 0 to 15 days
- 16 to 30 days
- 31 to 45 days
- 46 to 60 days
- 61 to 90 days
- More than 90 days

## Required Measures

- Active inventory count
- Average age
- Median age
- Inventory value
- Aged inventory count
- Aged inventory percentage
- Average cost by age bucket
- Average markdown by age bucket
- Gross by age at sale
- Inventory count by model
- Inventory count by acquisition source
- Inventory investment by store
- Units not front-line ready
- Time to front-line readiness

## Primary Questions

- Which inventory is approaching the dealership’s risk threshold?
- Which models consistently age?
- Are aged vehicles priced incorrectly from day one?
- How much capital is tied up in slow-moving inventory?
- Does gross decline predictably as age increases?
- Which stores are carrying excessive inventory relative to sales pace?

---

# 4.4 Days to Sale and Inventory Turn

## Required Measures

- Days to sale
- Average days to sale
- Median days to sale
- Inventory turn
- Dealer days supply
- Sell-through rate
- Acquisition-to-front-line-ready time
- Front-line-ready-to-sale time
- Aging risk rate
- Stock-to-sale ratio

## Metric Governance Note

Turn and days-supply calculations vary across vendors. The project must document:

- Time period used
- Included inventory
- Included sales
- Retail versus wholesale treatment
- New versus used treatment
- Whether sold units are included in denominator logic
- Whether rolling averages are used

---

# 4.5 Lead Conversion and BDC Performance

## Required Funnel Measures

- Leads received
- Leads contacted
- Contact rate
- Appointments set
- Appointment-set rate
- Appointments confirmed
- Shows
- Show rate
- Test drives
- Write-ups
- Vehicles sold
- Lead-to-sale conversion
- Show-to-sale conversion
- Average response time
- Median response time
- Leads without follow-up
- Duplicate leads
- Lost-lead reason
- Follow-up attempts
- Time to first meaningful response
- Lead aging

## Recommended Dimensions

- Lead source
- Campaign
- Vehicle of interest
- New versus used
- Salesperson
- BDC representative
- Store
- Day of week
- Hour received
- Response-time band
- Device or channel
- Lost reason

## Primary Questions

- Which sources generate leads but not sales?
- Where does the funnel break?
- Does response time affect contact or appointment rates?
- Which employees set appointments that actually show?
- Are leads being marked lost without sufficient follow-up?
- Which campaigns produce high-quality appointments?
- Which sources create duplicate or low-intent leads?

---

# 4.6 Salesperson Performance

## Required Measures

- Units sold
- Front gross
- Back gross
- Total gross
- Gross per unit
- Closing rate
- Lead conversion
- Appointment-show conversion
- Discount rate
- Product penetration
- New versus used mix
- Customer-retention rate
- Cancellation rate
- Chargeback rate
- Follow-up compliance
- Average days from lead to sale
- Goal attainment

## Interpretation Constraint

The dashboard must not use unit volume as the only employee ranking metric.

A high-volume employee may also have:

- Weak gross retention
- Low CRM compliance
- Poor follow-up
- High discounting
- Weak F&I product penetration
- High cancellation rates
- Favorable lead routing
- Better inventory access
- More experienced management support

Employee analysis should provide context rather than create simplistic rankings.

---

# 4.7 Model and Trim Performance

## Required Measures

- Units sold
- Inventory count
- Days supply
- Average age
- Average price
- Average discount
- Front gross
- Gross per unit
- Lead demand
- Lead-to-sale conversion
- Turn
- Internal market share
- Color concentration
- Trim concentration
- Discount frequency
- Age at sale

## Primary Questions

- Which models have high demand but insufficient supply?
- Which models have excess supply relative to conversion?
- Which trims turn quickly?
- Which models require excessive discounting?
- Which body styles create the strongest gross?
- Are certain colors or configurations aging disproportionately?

---

# 4.8 New Versus Used Performance

## Required Comparisons

- Units
- Revenue
- Front gross
- Back gross
- Total gross
- Gross per unit
- Days to sale
- Discounting
- Lead conversion
- F&I penetration
- Inventory aging
- Capital invested
- Turn
- Days supply
- Marketing cost per sale
- Acquisition cost
- Reconditioning cost

## Primary Questions

- Which department is creating more profit per unit?
- Which department is consuming more working capital?
- Does one department rely more heavily on discounting?
- Which department converts leads more effectively?
- Are used vehicles taking too long to become front-line ready?
- Are new-vehicle incentives distorting front gross?

---

# 4.9 F&I Product Penetration

## Required Measures

- Finance penetration
- Cash-deal percentage
- Lease penetration
- Service-contract penetration
- GAP penetration
- Maintenance-plan penetration
- Tire-and-wheel penetration
- Appearance-protection penetration
- Products per retail unit
- Back gross per retail unit
- Product gross
- Chargeback rate
- Cancellation rate
- Penetration by finance manager
- Penetration by salesperson
- Penetration by lender
- Penetration by vehicle type
- Penetration by credit tier
- Penetration by new versus used
- Penetration by deal eligibility

## Data Constraint

The project should use fictional customers and simplified finance data. It should not model:

- Social Security numbers
- Real credit files
- Bank-account details
- Full credit applications
- Actual lender decision records
- Personally identifiable financial data

---

# 4.10 Customer Acquisition Sources and Marketing ROI

## Required Measures

- Leads by source
- Appointments by source
- Shows by source
- Sales by source
- Lead conversion by source
- Cost per lead
- Cost per appointment
- Cost per show
- Cost per sale
- Revenue by source
- Gross by source
- Return on advertising spend
- Gross return on advertising spend
- Average days to sale by source
- Duplicate-lead rate
- Organic versus paid contribution
- Campaign-level performance
- Source-level gross per sale
- Source-level cancellation rate

## Interpretation Rule

Revenue-only ROI can be misleading because dealership revenue includes vehicle cost. Gross-based return should be available.

---

# 4.11 Vehicle Pricing and Discounting

## Required Measures

- MSRP
- Original asking price
- Current asking price
- Sale price
- Discount from MSRP
- Discount from original asking price
- Markdown amount
- Markdown frequency
- Days between markdowns
- Market price difference
- Gross after discount
- Price-to-market ratio
- Discount by salesperson
- Discount by manager
- Discount by model
- Discount by age bucket
- Discount by source

## Primary Questions

- Are vehicles priced correctly at acquisition?
- Do markdowns occur too late?
- Which models require repeated price changes?
- Does discounting improve turn enough to justify gross loss?
- Which stores discount most aggressively?
- Are employees applying inconsistent discounts?

---

# 4.12 Customer Retention

## Recommended Measures

- Repeat-customer rate
- Time since prior purchase
- Trade-cycle duration
- Service customer converted to sales customer
- Prior purchaser returned to service
- Household repeat rate
- Lost-customer rate
- Retention by salesperson
- Retention by model
- Retention by acquisition source
- Retention by store
- Retention by vehicle type

## Primary Questions

- Which customers return?
- Which sources create the strongest long-term value?
- Which salespeople retain customers?
- How long is the typical replacement cycle?
- Does service engagement predict repeat purchase?
- Which customers are approaching a likely trade cycle?

---

# 4.13 Service-to-Sales Opportunities

## Recommended Measures

- Service customers with older vehicles
- Customers above a mileage threshold
- High repair-estimate opportunities
- Declined repair opportunities
- Positive-equity opportunities
- Lease-maturity opportunities
- Vehicles with strong replacement demand
- Appraisals completed
- Trades acquired
- Service-to-sales appointments
- Service-to-sale conversions
- Opportunity aging
- Opportunity conversion by service advisor
- Opportunity conversion by salesperson

## Interpretation Rule

Service-to-sales opportunity logic must be presented as decision support, not as a guarantee of customer purchase intent.

---

# 5. Dataset Strategy

## 5.1 Core Finding

No single suitable public dataset contains all required dealership operational data.

Public automotive datasets typically cover one or more of the following:

- VIN specifications
- Vehicle listings
- Auctions
- Registrations
- Aggregate vehicle sales
- Pricing
- Safety and recall information

They generally do not contain an integrated dealership record covering:

- CRM leads
- Appointments
- Salespeople
- Inventory history
- Deal-level gross
- F&I products
- Marketing spend
- Service retention
- Customer lifecycle

Therefore:

> Synthetic data is not merely acceptable. It is necessary.

## 5.2 Recommended Dataset Strategy

1. Use authoritative public data for vehicle attributes and external context.
2. Generate synthetic dealership transactions and operational events.
3. Publish generation assumptions and validation rules.
4. Clearly label every synthetic field and record.
5. Avoid representing synthetic results as real dealership benchmarks.
6. Use fixed random seeds for reproducibility.
7. Maintain a clean separation between raw sources, generated operational data, transformed warehouse data, and reporting outputs.

---

## 5.3 NHTSA vPIC

### Source

NHTSA Product Information Catalog and Vehicle Listing API.

### Available Fields

Depending on the endpoint and VIN:

- VIN decoding
- Manufacturer
- Make
- Model
- Model year
- Body class
- Vehicle type
- Engine attributes
- Fuel type
- Plant information
- Series
- Trim information where submitted
- Manufacturer-reported specifications

### Missing Fields

- Dealership acquisition cost
- Inventory dates
- Asking prices
- Sale dates
- Sale prices
- Gross profit
- Lead activity
- Employees
- F&I products
- Marketing costs
- Customer behavior

### Data-Quality Concerns

- Some fields may be missing or inconsistently populated
- Trim naming may not be fully standardized
- Manufacturer submissions may vary in completeness
- Decoding does not provide dealership transaction history

### Augmentation Requirement

High.

### Recommendation

Use vPIC to enrich the vehicle dimension, not to supply the transaction dataset.

---

## 5.4 NADA Aggregate Reports

### Source

NADA annual and semiannual dealership reports.

### Available Fields

NADA publishes aggregate information on:

- Franchised dealership sales
- Industry financial trends
- Vehicle volume
- Dealership counts
- Service-and-parts activity
- Dealership economics

### Missing Fields

- Individual dealership records
- Individual deals
- Lead records
- Customer records
- Vehicle-level inventory history
- Employee performance
- F&I product records

### Data-Quality Concerns

The data is aggregated and cannot directly support dealership-level operational analysis.

### Augmentation Requirement

Complete synthetic augmentation is required.

### Recommendation

Use NADA only for contextual plausibility checks and industry framing.

---

## 5.5 Federal Transportation and Sales Datasets

### Candidate Sources

- Bureau of Transportation Statistics
- Bureau of Economic Analysis
- Data.gov automotive datasets
- State vehicle registration datasets
- Aggregate vehicle-sales series

### Available Fields

Depending on the dataset:

- Month or year
- Vehicle class
- Vehicle type
- Fuel type
- County or state
- Registration counts
- Aggregate new and used sales
- Aggregate sales value

### Missing Fields

Most dealership operational fields.

### Augmentation Requirement

High.

### Recommendation

Use one aggregate dataset as an external-market context table. For example, compare synthetic dealership sales trends with broader monthly market trends.

---

## 5.6 Kaggle Vehicle-Sales Datasets

### Candidate Data Types

Publicly listed datasets may include:

- Vehicle transaction records
- Auction records
- Used-car listings
- Craigslist vehicle listings
- Synthetic dealership sales data
- Historical market data

### Common Fields

- Year
- Make
- Model
- Trim
- Body type
- Transmission
- VIN
- Odometer
- Condition
- Color
- Seller
- Market value
- Sale price
- Sale date
- State

### Missing Fields

- Dealership ownership dates
- Salesperson
- CRM activity
- Gross
- F&I
- Marketing attribution
- Service history
- Customer retention

### Licensing Concern

Kaggle hosting does not automatically establish unrestricted reuse rights.

Before including any dataset, the repository must record:

- Named creator
- Source URL
- License
- Permitted uses
- Required attribution
- Redistribution restrictions
- Whether derived files may be committed to GitHub

A missing or ambiguous license should be treated as a blocker for redistribution.

### Data-Quality Concerns

- Missing values
- Duplicate VINs
- Inconsistent make and model names
- Auction transactions presented as retail sales
- Historical data that may not represent the current market
- Unclear provenance
- Unrealistic synthetic values
- Inconsistent date formatting
- Mixed transaction types

### Recommendation

Use Kaggle data only for seed distributions, exploratory benchmarking, or supplemental examples after license verification.

---

## 5.7 Recommended Synthetic Dataset

The primary dataset should represent a fictional three-store dealership group over 24 months.

### Recommended Scale

| Entity | Recommended Volume |
|---|---:|
| Dealerships | 3 |
| Vehicle records | 8,000 to 15,000 |
| Retail and wholesale transactions | 6,000 to 10,000 |
| Lead events | 40,000 to 80,000 |
| Customer records | 15,000 to 30,000 |
| Sales and BDC employees | 25 to 50 |
| Finance managers | 6 to 12 |
| Marketing campaigns | 20 to 40 |
| Service opportunity snapshots | Monthly or event-based |

This is large enough to demonstrate modeling and analytical depth without creating unnecessary infrastructure problems.

---

## 5.8 Synthetic Data Realism Rules

The generator must encode believable relationships.

Examples:

- Older inventory receives more markdowns.
- Excessive age generally reduces expected front gross.
- Used vehicles have wider gross variance than new vehicles.
- Faster response time improves contact probability but does not guarantee a sale.
- Appointment shows convert at a higher rate than unappointed showroom visits.
- Some sources have low cost per lead but weak closing rates.
- Finance-product eligibility and penetration vary by deal type.
- Chargebacks occur after the original sale.
- Employee performance is heterogeneous.
- Seasonality affects leads, sales, and inventory.
- Dealership stores have different market profiles.
- High-performing models can still have poor gross if supply is excessive.
- Service-to-sales opportunities depend on vehicle age, mileage, repair estimate, and ownership duration.
- Reconditioning delay increases used-vehicle aging risk.
- Lead quality varies by source and campaign.
- Discount authority varies by employee role.
- Inventory acquisition source affects cost, condition, and turn.
- Some customers return while others remain one-time buyers.

The relationships must not be perfectly deterministic. Perfect correlations would reveal artificial generation and reduce analytical credibility.

---

# 6. Technical Architecture Comparison

## 6.1 Summary Matrix

| Technology | Strength | Main Risk | Recommendation |
|---|---|---|---|
| PostgreSQL | Professional relational warehouse | More setup than SQLite | Primary database |
| SQLite | Simple and portable | Weak enterprise BI story | Testing or fallback only |
| SQL Server | Strong Power BI alignment | Higher setup and licensing complexity | Viable but not preferred |
| Python and pandas | Generation, validation, analysis | Logic can become notebook-bound | Core support layer |
| Power BI | Strong BI market relevance | Distribution and licensing constraints | Primary dashboard |
| Tableau | Strong visualization | Duplicates Power BI effort | Exclude from version one |
| Excel | Operational relevance | Manual and difficult to govern at scale | Supporting deliverable |
| FastAPI | Clean API layer | Scope expansion | Advanced phase only |
| Streamlit | Fast public demo | Prototype appearance and duplicate interface | Not recommended |
| React or Next.js | Strong public presentation | Overengineering risk | Static case study only |
| Supabase | Managed PostgreSQL | Unnecessary platform features may distract | Recommended hosting option |
| Complex cloud stack | Enterprise signaling | Excessive complexity | Exclude |

---

## 6.2 PostgreSQL

### Strengths

- Professional relational database
- Strong SQL support
- Views and materialized views
- Constraints and indexes
- Window functions
- Date operations
- JSONB support
- Suitable for local and hosted deployment
- Strong fit for Python and Power BI
- Mature ecosystem
- Portable SQL foundation

### Weaknesses

- More setup than SQLite
- Requires connection and credential management
- Power BI refresh behavior must be tested early
- Hosted access requires security controls

### Verdict

Recommended as the primary database.

---

## 6.3 SQLite

### Strengths

- Simple
- Portable
- No database server
- Easy for automated tests
- Useful for local experimentation

### Weaknesses

- Less representative of enterprise analytics
- Weaker concurrency and administration story
- Less compelling for BI infrastructure
- Direct Power BI integration is less straightforward
- Encourages an overly local file-based design

### Verdict

Use only as an optional testing or fallback database.

---

## 6.4 SQL Server

### Strengths

- Excellent Power BI alignment
- Common in Microsoft environments
- Strong analytics capabilities
- Strong security and administration capabilities
- High enterprise relevance

### Weaknesses

- More deployment complexity
- Potential licensing and hosting overhead
- Less aligned with Michael’s current Supabase and PostgreSQL experience
- Adds platform-specific administration work

### Verdict

Technically strong, but PostgreSQL provides a better cost-to-complexity ratio for this portfolio.

---

## 6.5 Python and pandas

### Strengths

- Excellent for synthetic generation
- Strong data-cleaning capabilities
- Reproducible
- Testable
- Useful for validation and exploratory analysis
- Demonstrates an employer-requested skill
- Supports automated quality checks
- Integrates well with PostgreSQL

### Weaknesses

- Large transformations can become memory intensive
- Easy to create undocumented notebook logic
- Can duplicate logic that belongs in SQL
- Poorly structured scripts can become difficult to maintain

### Verdict

Use Python for ingestion, generation, validation, and selected transformations. Keep core business metrics in SQL or documented Power BI measures.

---

## 6.6 Power BI

### Strengths

- Strong hiring relevance
- Demonstrates modeling and DAX
- Supports drill-through and interactive analysis
- Suitable for executive and operational dashboards
- Works well with star schemas
- Reinforces SQL and business intelligence positioning
- Supports reusable measures
- Supports role-based navigation
- Supports executive scorecards

### Weaknesses

- Development is tied to the Microsoft ecosystem
- Public sharing and refresh require licensing decisions
- The `.pbix` file is not easily reviewed through standard Git diffs
- DAX can hide poorly documented business logic
- Report distribution can be difficult without an organizational Power BI tenant

### Verdict

Primary dashboard and business-facing deliverable.

---

## 6.7 Tableau

### Strengths

- Strong visual analytics platform
- Widely recognized
- Good public portfolio capabilities

### Weaknesses

- Duplicates Power BI’s role
- Adds learning and maintenance overhead
- Splits project quality across two dashboard tools
- Does not materially strengthen version one

### Verdict

Exclude from version one.

---

## 6.8 Excel

### Strengths

- Highly relevant to operations roles
- Familiar to dealership managers
- Useful for reconciliations
- Useful for ad hoc review
- Demonstrates practical business reporting
- Supports Power Query
- Supports operational exports

### Weaknesses

- Weak as the primary analytics platform
- Manual workflows can reduce reproducibility
- Large workbooks become difficult to govern
- Formula logic can become opaque

### Verdict

Include one professional Excel management report, but not as the core platform.

---

## 6.9 FastAPI

### Strengths

- Clean API framework
- Fits Michael’s current skills
- Useful for later web integration
- Can expose approved aggregate endpoints
- Supports typed contracts and documentation

### Weaknesses

- Not required for Power BI
- Adds authentication, deployment, testing, and documentation work
- Risks shifting attention from analytics to software engineering
- Increases security scope

### Verdict

Exclude from the minimum viable product. Consider only in the advanced phase.

---

## 6.10 Streamlit

### Strengths

- Fast route to a public interactive application
- Python-native
- Useful for showcasing analytical outputs

### Weaknesses

- Can look like a prototype
- Adds another reporting interface
- Does not demonstrate Power BI
- Encourages UI work before model maturity
- Can create duplicate metric logic

### Verdict

Not recommended for the core project.

---

## 6.11 React or Next.js

### Strengths

- High-quality custom user interface
- Strong alignment with Michael’s existing portfolio
- Useful for public storytelling
- Easy to host as a static case study
- Supports screenshots, architecture diagrams, and findings

### Weaknesses

- High overengineering risk
- Dashboard components can distract from SQL, DAX, modeling, and analytical reasoning
- A custom interface does not prove enterprise BI competence
- Michael already has several software-oriented projects
- Adds another place where KPI logic could diverge

### Verdict

Use only for a small public case-study shell after the core Power BI work is complete.

---

## 6.12 Supabase

### Strengths

- Hosted PostgreSQL
- Familiar to Michael
- Easy connection management
- Portable PostgreSQL foundation
- Optional APIs
- Optional authentication
- Optional storage
- Optional row-level security

### Weaknesses

- Most Supabase platform features are unnecessary for a BI portfolio
- Public-facing database access must be locked down
- Free-tier limitations should be reviewed
- Power BI connectivity and refresh must be tested early
- Platform extras can encourage scope growth

### Verdict

Recommended as a PostgreSQL hosting option, but use Supabase primarily as a managed database.

---

## 6.13 Cloud Deployment

### Recommended Cloud Scope

- Hosted PostgreSQL database
- Public GitHub repository
- Static documentation
- Dashboard screenshots
- Architecture diagrams
- Optional static case-study page
- Optional published Power BI access where licensing permits

### Technologies to Exclude Initially

- Kubernetes
- Data lake architecture
- Event streaming
- Kafka
- Databricks
- Microsoft Fabric
- Airflow
- Microservices
- Complex CI/CD environments
- Real-time event processing
- Serverless workflow orchestration

These technologies do not solve the project’s primary hiring objective.

---

# 7. Core Deliverable Decision

## 7.1 Option A: Power BI Dashboard Backed by SQL

### Advantages

- Strongest alignment with Data Analyst and BI roles
- Demonstrates SQL, modeling, Power Query, DAX, and visualization
- Familiar to corporate employers
- Keeps emphasis on analysis
- Supports executive and operational views

### Disadvantages

- Less publicly accessible than a normal website
- Power BI file review can be inconvenient
- Sharing may be limited by licensing

### Assessment

Strong choice.

---

## 7.2 Option B: Web Analytics Application

### Advantages

- Publicly accessible
- Visually impressive
- Demonstrates full-stack capability
- Easy to feature in a software portfolio

### Disadvantages

- Risks looking like another software project
- Does not prove Power BI or DAX
- Can hide weak data modeling
- Adds substantial UI and API work
- Encourages duplicated analytical logic

### Assessment

Wrong primary choice for Michael because his portfolio already demonstrates software-development ability.

---

## 7.3 Option C: Hybrid Project

### Advantages

- Strongest overall presentation
- Power BI demonstrates enterprise BI
- A web case study improves public accessibility
- PostgreSQL and Python support both
- Produces several portfolio artifacts from one data platform

### Disadvantages

- Scope must be tightly controlled
- High overengineering risk
- Requires strict sequencing

### Correct Interpretation of Hybrid

The hybrid should mean:

1. PostgreSQL analytics warehouse
2. Python data pipeline
3. Power BI dashboard
4. Documentation
5. Small public case-study page

It should not mean building two complete dashboard applications.

### Assessment

Best overall choice if implementation order remains disciplined.

---

## 7.4 Option D: Notebook-Based Analysis

### Advantages

- Easy to review
- Good for exploratory work
- Demonstrates Python and statistics

### Disadvantages

- Weak executive reporting
- Common classroom format
- Limited operational usability
- Does not demonstrate Power BI or semantic modeling
- Can encourage disconnected analysis

### Assessment

Use notebooks only as supporting evidence.

---

## 7.5 Final Decision

The core deliverable should be:

> A Power BI dealership intelligence dashboard backed by a PostgreSQL dimensional warehouse, supported by Python validation and a concise public case study.

---

# 8. What Distinguishes a Strong Portfolio Project

## 8.1 A Real Business Problem

The project must begin with dealership decisions, not a dataset.

Weak framing:

> Analyze a car-sales dataset and create visualizations.

Strong framing:

> Help a dealership group identify profit leakage, lead-funnel breakdowns, aging inventory, pricing problems, and employee-performance opportunities.

---

## 8.2 Defined Users

The project should identify specific users:

- Dealer principal
- General manager
- General sales manager
- New-car manager
- Used-car manager
- Internet or BDC director
- Finance director
- Marketing manager
- Regional operations leader
- Fixed-operations manager

---

## 8.3 Documented Requirements

Include:

- Stakeholder questions
- KPI definitions
- Report-refresh expectations
- Data-quality requirements
- Security assumptions
- Known limitations
- Acceptance criteria
- Explicit non-goals

---

## 8.4 Intentional Data Model

The repository should show:

- Entity-relationship diagram
- Dimensional model
- Fact-table grain
- Dimension definitions
- Relationship cardinality
- Source-to-target mappings
- Key-generation strategy
- Date handling
- Snapshot logic

---

## 8.5 Reproducibility

A reviewer should be able to understand:

- Where data comes from
- How synthetic data is generated
- How transformations run
- How tables are populated
- How metrics are calculated
- How data quality is tested
- How the dashboard is refreshed
- How results can be regenerated

---

## 8.6 Data Quality

Include tests for:

- Duplicate primary keys
- Missing foreign keys
- Invalid dates
- Sale date before acquisition date
- Negative inventory age
- Impossible funnel transitions
- Sale prices outside plausible boundaries
- Gross calculations that do not reconcile
- Finance penetration exceeding eligible deals
- Appointments showing before they were created
- Duplicate leads
- Negative marketing spend
- Invalid employee assignments
- Inventory sold more than once
- Service opportunities tied to nonexistent customers

---

## 8.7 Analytical Findings

The project must include an executive findings document.

Potential findings could include:

- A lead source produces high volume but poor gross-adjusted return.
- A model has strong lead demand but excessive inventory supply.
- A store’s appointment-set rate appears strong, but its show rate is weak.
- A salesperson’s high unit volume is offset by discounting and weak gross.
- Used vehicles acquired through one channel take longer to become front-line ready.
- Product penetration varies materially by finance manager after controlling for deal type.
- Aged inventory markdowns occur too late to protect turn.
- Service-to-sales opportunities convert differently by repair-estimate band.

---

## 8.8 Recommendations

Each major finding should lead to a specific operational recommendation.

Examples:

- Reallocate advertising spend from low-gross sources.
- Establish earlier markdown triggers for specific age buckets.
- Review lead routing and follow-up for low-show sources.
- Coach high-volume, low-gross employees on discount discipline.
- Improve used-vehicle reconditioning cycle time.
- Standardize F&I product presentation and eligibility documentation.
- Create a service-lane equity mining process.

---

## 8.9 Limitations

State clearly:

- Data is synthetic.
- Results do not represent an actual dealership.
- Synthetic relationships were intentionally introduced.
- External market measures may be historical or aggregate.
- The project is a decision-support demonstration, not a production DMS or CRM.
- Statistical relationships do not prove causation.
- Employee scorecards require operational context.
- Industry benchmarks may differ by franchise, geography, and dealership size.

---

## 8.10 Classroom-Project Warning Signs

Avoid:

- One flat CSV
- A dashboard with no data model
- Default visual formatting
- Only descriptive charts
- No KPI definitions
- No tests
- No stated audience
- No recommendations
- No source licensing record
- No privacy analysis
- A notebook titled only `EDA`
- Claims that charts prove causation
- A machine-learning model added only to appear advanced
- A web interface that hides undeveloped analytics
- Hard-coded metrics without documentation
- No reconciliation between source and report totals

---

# 9. Recommended Project Scope

## 9.1 Minimum Viable Version

### Data Domains

- Inventory
- Vehicle sales
- Leads
- Employees
- Basic marketing sources

### Technical Components

- PostgreSQL database
- Python synthetic-data generator
- Staging tables
- Star schema
- SQL transformations
- Power BI dashboard
- Data dictionary
- Architecture document
- Validation script

### Dashboard Pages

1. Executive overview
2. Sales and gross
3. Inventory aging
4. Lead funnel
5. Salesperson performance

### Minimum KPI Set

- Units sold
- New and used mix
- Front gross
- Back gross
- Total gross
- Gross per unit
- Inventory count
- Average age
- Aged inventory percentage
- Days to sale
- Lead conversion
- Appointment-set rate
- Show rate
- Show-to-sale conversion
- Source-level cost per sale
- Salesperson units
- Salesperson gross

---

## 9.2 Strong Portfolio Version

Add:

- F&I product penetration
- Marketing cost and gross-based return
- Price and markdown history
- Dealership-store comparison
- Target and forecast tracking
- Cohort analysis
- Retention analysis
- Service-to-sales opportunities
- External market context
- Automated data-quality report
- Executive findings memo
- Excel operating report
- Public case-study page
- Dashboard walkthrough video
- Sample stakeholder requirements
- Source-to-target documentation
- KPI catalog

---

## 9.3 Optional Advanced Features

Only after the strong version is complete:

- FastAPI read-only aggregate endpoints
- Next.js management-summary page
- Statistical lead-response analysis
- Inventory-risk scoring
- Sales forecasting
- Anomaly alerts
- Natural-language metric definitions
- Scenario analysis for price reductions
- Row-level security demonstration
- Incremental data loads
- Automated refresh workflow
- Model-performance monitoring for any later predictive feature

---

## 9.4 Features to Exclude Initially

- Customer login
- Real dealership data
- Full CRM functionality
- Full DMS simulation
- Payment calculator
- Vehicle shopping interface
- AI chatbot
- Machine-learning model without a validated business need
- Real-time streaming
- Multi-tenant architecture
- Mobile application
- Native VIN scanner
- Complex role-based permissions
- Multiple dashboard frameworks
- Both Tableau and Power BI
- Full cloud data-engineering platform
- Customer-facing retail functionality
- Payment or financing workflows

The largest risk is turning the project into another automotive software application. Its purpose is to demonstrate professional analytics.

---

# 10. Privacy, Legal, Ethical, and Security Considerations

## 10.1 FTC Safeguards Rule

Most automobile dealers that finance or lease vehicles are treated as financial institutions under the FTC Safeguards Rule.

This creates a strong reason not to use actual dealership CRM, DMS, credit, or finance records.

The portfolio should treat dealership consumer data as sensitive even when the project itself uses only synthetic data.

---

## 10.2 Data That Must Not Appear

Do not include:

- Real customer names
- Social Security numbers
- Driver’s-license numbers
- Full birth dates
- Personal email addresses
- Phone numbers
- Home addresses
- Bank-account information
- Credit scores tied to identifiable people
- Credit-application details
- Insurance information
- Actual deal jackets
- Real employee compensation
- Authentication secrets
- Database passwords
- Complete real customer VIN ownership history
- Real lender decision data
- Real dealership exports without written authorization

---

## 10.3 VIN Handling

A VIN is vehicle-specific rather than inherently customer-specific, but a VIN connected to a real owner, address, phone number, service record, or financing record can contribute to identifying a person.

Recommended options:

- Use synthetic VIN-like identifiers.
- Use fictional VINs created only for synthetic vehicles.
- Use NHTSA decoding during generation and store a masked identifier in published data.

Do not publish real dealership inventory exports without authorization.

---

## 10.4 Data Minimization

The project should store only fields required for analysis.

Examples:

- Store customer age band rather than full birth date.
- Store credit tier rather than precise credit score.
- Store county or market area rather than street address.
- Store a synthetic customer key rather than a name.
- Store response-time seconds rather than communication contents.
- Store household ID only when required for repeat-purchase analysis.
- Store product eligibility flags rather than full lender stipulations.

---

## 10.5 Bias and Fairness

Employee scorecards can be misleading if they ignore:

- Lead quality
- Store traffic
- Shift assignment
- Tenure
- Inventory availability
- Product mix
- Manager involvement
- Unequal lead routing
- Store location
- Franchise strength
- Advertising mix

The dashboard must not imply that ranking employees by raw sales volume is a fair performance evaluation.

F&I analysis should not use protected attributes or create discriminatory pricing recommendations.

---

## 10.6 Ethical Interpretation

The project should explicitly avoid:

- Treating correlation as causation
- Creating manipulative consumer targeting
- Recommending discriminatory lending behavior
- Ranking employees without context
- Presenting synthetic benchmarks as industry standards
- Using sensitive attributes to optimize profit
- Concealing data limitations
- Claiming predictive certainty
- Encouraging harmful pricing practices

---

## 10.7 Security Controls

For a public portfolio project:

- Use environment variables for database credentials.
- Commit an example environment file without secrets.
- Use read-only credentials for dashboards.
- Restrict network access where practical.
- Enable TLS.
- Do not expose administrative database credentials.
- Apply least privilege.
- Separate raw, transformed, and reporting schemas.
- Sanitize all exported example data.
- Rotate any credential accidentally committed.
- Keep the public web layer restricted to aggregate, non-sensitive data.
- Do not expose direct write access from a public client.
- Maintain a documented secret-handling policy.
- Review repository history for accidental secret exposure.

---

# 11. Final Project Recommendation

## 11.1 Working Concept

### Recommended Working Title

**DealerPulse BI**

### Fictional Organization

**Granite State Auto Group**

### Alternative Names

- Dealer Performance Intelligence
- RetailDrive BI
- AutoRetail Intelligence
- DealerOps Analytics
- VelocityIQ

A final public name should be checked for repository, trademark, and domain conflicts before launch.

---

## 11.2 Business Problem

Dealership data is often distributed across DMS, CRM, inventory, F&I, marketing, and service systems.

Managers may receive separate reports with:

- Inconsistent metric definitions
- Delayed updates
- Duplicate records
- Weak reconciliation
- Limited cross-functional analysis
- No single view of profitability
- No connection between lead quality and gross
- No connection between inventory age and pricing
- No connection between service activity and future sales opportunity

The project will create a unified analytical model that helps dealership management identify:

- Sales and gross trends
- Inventory-capital risk
- Lead-funnel breakdowns
- Pricing and discount problems
- Employee-performance differences
- Marketing-source effectiveness
- F&I penetration opportunities
- Customer-retention opportunities
- Service-to-sales opportunities

---

## 11.3 Target Users

### Primary Users

- Dealer principal
- General manager
- General sales manager
- Used-car manager
- Internet or BDC director
- Finance director

### Secondary Users

- Marketing manager
- Regional operations manager
- Data or BI analyst
- Sales manager
- Fixed-operations manager
- New-car manager

---

## 11.4 Key Analytical Questions

1. Are sales, gross, and gross per unit improving?
2. Which stores, departments, models, and employees explain the change?
3. How much capital is tied up in aged inventory?
4. Which vehicles are at greatest aging or markdown risk?
5. Which lead sources generate profitable sales rather than only volume?
6. Where are leads being lost in the contact-to-sale funnel?
7. How does response time relate to contact, appointment, and sale outcomes?
8. Which employees balance volume, conversion, and gross retention?
9. Which models have mismatched supply and demand?
10. How does inventory age affect discounting and gross?
11. Which finance products have weak or inconsistent penetration?
12. Which customer cohorts are most likely to return?
13. Which service customers represent credible sales opportunities?
14. Which operational actions are most likely to improve profitability?
15. Which stores are missing goals despite adequate lead volume?
16. Which marketing campaigns produce gross rather than only clicks or leads?

---

## 11.5 Required KPI Groups

### Executive

- Units sold
- Revenue
- Front gross
- Back gross
- Total gross
- Gross per retail unit
- Lead conversion
- Inventory count
- Average inventory age
- Aged inventory percentage
- Days supply
- Target attainment

### Sales

- Units by store, department, model, employee, and source
- New versus used mix
- Closing rate
- Discount rate
- Gross per unit
- Pace against target

### Inventory

- Active units
- Inventory investment
- Average age
- Median age
- Age buckets
- Days to sale
- Turn
- Days supply
- Markdown frequency
- Gross by age at sale

### CRM and BDC

- Contact rate
- Appointment-set rate
- Show rate
- Show-to-sale conversion
- Lead-to-sale conversion
- Response time
- Follow-up compliance
- Conversion by source

### F&I

- Finance penetration
- Product penetration
- Products per retail unit
- Back gross per retail unit
- Chargeback rate
- Cancellation rate

### Marketing

- Cost per lead
- Cost per appointment
- Cost per sale
- Revenue by source
- Gross by source
- Gross return on advertising spend

### Retention

- Repeat-purchase rate
- Service retention
- Service-to-sales opportunity count
- Service-to-sales conversion

---

## 11.6 Recommended Data Model

### Fact Tables

- `fact_vehicle_inventory_snapshot`
- `fact_vehicle_sale`
- `fact_lead`
- `fact_lead_activity`
- `fact_appointment`
- `fact_marketing_spend`
- `fact_finance_product_sale`
- `fact_service_visit`
- `fact_inventory_price_history`

### Dimension Tables

- `dim_date`
- `dim_dealership`
- `dim_vehicle`
- `dim_vehicle_model`
- `dim_employee`
- `dim_customer`
- `dim_lead_source`
- `dim_marketing_campaign`
- `dim_finance_product`
- `dim_lender`
- `dim_sale_type`
- `dim_inventory_source`
- `dim_geography`

The exact grain of every fact table must be finalized before database implementation.

---

## 11.7 Recommended Technology Stack

### Core

- PostgreSQL
- Supabase-hosted PostgreSQL or equivalent managed PostgreSQL
- Python
- pandas
- SQL
- Power BI Desktop
- Power Query
- DAX
- Excel
- GitHub

### Documentation

- Markdown
- Mermaid diagrams or exported architecture diagrams
- Data dictionary
- KPI catalog
- Source-to-target mapping
- Architecture decision records

### Optional Presentation

- Next.js case-study page
- Static screenshots
- Recorded dashboard walkthrough

---

## 11.8 Expected Deliverables

1. `README.md`
2. `ARCHITECTURE.md`
3. `research.md`
4. `DATA_DICTIONARY.md`
5. `KPI_CATALOG.md`
6. `DATA_GENERATION.md`
7. `PRIVACY_AND_ETHICS.md`
8. `LIMITATIONS.md`
9. SQL schema files
10. SQL transformation files
11. Python synthetic-data generator
12. Data-validation tests
13. Entity-relationship diagram
14. Star-schema diagram
15. Power BI report
16. Power BI model documentation
17. Executive findings memo
18. Excel management report
19. Dashboard screenshots
20. Short walkthrough video
21. Resume bullets
22. LinkedIn launch post

---

## 11.9 Implementation Phases

### Phase 1: Product Definition

- Select final project name
- Define target users
- Define business questions
- Approve scope
- Finalize architecture
- Finalize KPI definitions

### Phase 2: Data Design

- Define facts and dimensions
- Establish grain
- Define synthetic-data rules
- Create data dictionary
- Define quality checks
- Define source-to-target mappings

### Phase 3: Data Generation and Ingestion

- Generate dealership records
- Enrich vehicle attributes
- Populate staging tables
- Record lineage
- Validate distributions
- Record generation seed and version

### Phase 4: Warehouse Transformation

- Build dimensions
- Build facts
- Create reporting views
- Add constraints
- Add indexes
- Validate reconciliations
- Document load sequence

### Phase 5: Power BI Semantic Model

- Connect to reporting layer
- Build relationships
- Create measures
- Establish hierarchies
- Validate filter behavior
- Document DAX
- Validate totals against SQL

### Phase 6: Dashboard Development

- Build executive page
- Build sales and gross page
- Build inventory page
- Build CRM funnel page
- Build employee page
- Build F&I page
- Build marketing page
- Build retention page

### Phase 7: Analytical Findings

- Identify meaningful patterns
- Validate findings in SQL
- Write executive recommendations
- Document limitations
- Review causal claims
- Review fairness concerns

### Phase 8: Portfolio Packaging

- Finalize repository
- Add screenshots and diagrams
- Create walkthrough video
- Publish case study
- Write resume material
- Write LinkedIn material
- Perform final source and license review

---

## 11.10 Major Risks

### Overengineering

This is the largest risk.

**Mitigation:**

- Power BI first
- No custom application until the dashboard is complete
- No AI feature during the core build
- Architecture gates before optional features

### Unrealistic Synthetic Data

**Mitigation:**

- Encode domain-informed relationships
- Add randomness
- Validate distributions
- Publish assumptions
- Avoid perfect correlations
- Use fixed seeds for reproducibility

### Metric Ambiguity

**Mitigation:**

- Create a KPI catalog before dashboard construction
- Define numerators
- Define denominators
- Define time windows
- Define filters
- Define exclusions
- Define fact grain

### Licensing Uncertainty

**Mitigation:**

- Prefer federal and official sources
- Verify every third-party dataset license
- Do not redistribute unlicensed raw data
- Maintain a source registry

### Dashboard Without Analytical Depth

**Mitigation:**

- Require every report page to answer a management question
- Include written findings and actions
- Validate conclusions through SQL
- Include business context

### Portfolio Becoming Another Software Project

**Mitigation:**

- Measure success through SQL, modeling, Power BI, data quality, and business insight
- Treat Next.js and FastAPI as optional extensions
- Reject features that do not improve analytical proof

### Power BI Distribution Constraints

**Mitigation:**

- Include screenshots
- Include a walkthrough video
- Document the model
- Provide sample data
- Publish the `.pbix` file when permitted
- Create a static case study that does not depend on live Power BI access

---

# 12. Inputs Required for Architecture

The architecture document should resolve the following decisions.

## 12.1 Required Project Decisions

1. Final project name
2. Fictional dealership-group identity
3. Number of stores
4. Reporting period
5. Data volume
6. Geographic market
7. Franchises or brands represented
8. New, used, and certified-pre-owned scope
9. Included business domains
10. Explicitly excluded business domains
11. Power BI publication approach
12. PostgreSQL hosting approach
13. Public case-study approach
14. External datasets approved for use
15. Synthetic VIN policy
16. Customer de-identification model
17. KPI formulas
18. Fact-table grain
19. Snapshot frequency
20. Data-refresh model
21. Testing strategy
22. Security assumptions
23. Repository structure
24. Deployment boundaries
25. Completion criteria for each phase

## 12.2 Recommended Architecture Assumptions

Unless changed during architecture development:

- Three fictional dealerships
- Southern New England market
- Twenty-four months of data
- PostgreSQL hosted through Supabase
- Python-generated synthetic operational data
- NHTSA vPIC vehicle enrichment
- Optional federal aggregate market context
- Dimensional star or fact-constellation model
- Power BI as the primary interface
- One supporting Excel report
- One public static case-study page
- No real customer or dealership data
- No AI functionality in the main release
- No production CRM or DMS integration
- No live transactional system
- Daily or monthly synthetic refresh rather than real-time processing

---

# 13. Final Conclusion

The evidence favors a **business-intelligence project rather than another full-stack automotive application**.

Michael’s competitive advantage is not merely that he can create dashboards. It is that he understands the dealership decisions behind the numbers:

- Why a high-closing source may still be unprofitable
- Why aging inventory is a capital problem
- Why volume without gross retention is incomplete performance
- Why appointment-set rate is meaningless without show and sale conversion
- Why F&I penetration must be evaluated by deal eligibility and product mix
- Why service, sales, inventory, CRM, and marketing data must be connected
- Why employee rankings require context
- Why gross-based marketing return is more useful than revenue alone

The architecture should therefore optimize for:

- Analytical credibility
- Business realism
- Traceability
- Reproducibility
- Metric governance
- Portfolio clarity
- Privacy
- Decision support

The recommended foundation is:

> PostgreSQL dimensional warehouse + Python data pipeline + Power BI semantic model and dashboards + documented executive analysis.

That combination provides the strongest direct evidence for Data Analyst, Business Intelligence Analyst, Automotive Data Analyst, Sales Operations Analyst, Revenue Operations Analyst, Product Analyst, and Reporting Analyst roles.

---

# 14. Source Notes

The following source categories informed this report:

## Current Job Market

- Current Data Analyst and Business Intelligence job postings
- Current Sales Operations and Revenue Operations job postings
- Current automotive analytics job postings
- Employer requirements covering SQL, Excel, Power BI, Python, data modeling, ETL, and stakeholder communication

## Official Product Documentation

- Microsoft Power BI guidance on star schemas and semantic modeling
- PostgreSQL documentation on materialized views and JSONB
- Supabase documentation on managed PostgreSQL

## Automotive Industry Sources

- NADA dealership data and aggregate industry reports
- vAuto inventory-management KPI guidance
- NHTSA vPIC documentation and vehicle specification data
- Federal transportation and vehicle-sales datasets

## Legal and Privacy Sources

- FTC Safeguards Rule guidance for automobile dealers
- General data-minimization, least-privilege, and de-identification practices

## Public Dataset Sources

- NHTSA vPIC
- NADA aggregate reports
- Data.gov automotive datasets
- Bureau of Transportation Statistics
- Bureau of Economic Analysis
- State registration datasets
- Select Kaggle datasets, subject to license verification

---

## Reference Links

- Microsoft Power BI star-schema guidance: https://learn.microsoft.com/en-us/power-bi/guidance/star-schema
- PostgreSQL materialized views: https://www.postgresql.org/docs/current/rules-materializedviews.html
- PostgreSQL JSON types: https://www.postgresql.org/docs/current/datatype-json.html
- Supabase documentation: https://supabase.com/docs
- NHTSA vPIC API: https://vpic.nhtsa.dot.gov/api/
- NADA research and data: https://www.nada.org/nada/research-data/nada-data
- FTC Safeguards Rule guidance for automobile dealers: https://www.ftc.gov/business-guidance/resources/automobile-dealers-ftcs-safeguards-rule-frequently-asked-questions
- Data.gov auto-sales dataset catalog: https://catalog.data.gov/dataset/auto-sales

---

**End of report**
