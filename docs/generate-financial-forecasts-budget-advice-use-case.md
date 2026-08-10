# Generate Financial Forecasts and Budget Advice

**Users:** Admin, SBO Officer

**Generate Financial Forecasts and Budget Advice**
|-- <<include>> Load Historical Transactions
|-- <<include>> Validate Financial Dataset
|-- <<include>> Apply OLS Linear Regression
|-- <<include>> Forecast Budget Availability
|-- <<include>> Estimate Safe Spending Limit
|-- <<extend>> Detect Overspending Risk
|-- <<extend>> Detect Possible Deficit
|-- <<extend>> Generate Budget Advice
`-- <<extend>> Generate Financial Summary Using Groq LLM

## Implementation Coverage

- **Role Access:** Admin and SBO Officer can access financial insights and forecast APIs.
- **Load Historical Transactions:** `POST /forecasts/generate` groups up to 36 months of organization ledger records by month.
- **Validate Financial Dataset:** generation requires at least two populated transaction months; manual forecast inputs retain numeric validation.
- **Apply OLS Linear Regression:** the server calculates ordinary least squares slope and intercept values for monthly income and expense series.
- **Forecast Budget Availability:** forecasts store predicted income, expense, and balance.
- **Estimate Safe Spending Limit:** forecast records derive safe spending limit when not provided.
- **Detect Overspending/Deficit:** budget records store overspending risk and forecasts expose predicted balances.
- **Generate Budget Advice:** forecast confidence notes and budget advisory notes store guidance.
- **Generate Financial Summary Using Groq LLM:** the server requests a constrained Groq summary when configured and stores a deterministic fallback when Groq is unavailable.
