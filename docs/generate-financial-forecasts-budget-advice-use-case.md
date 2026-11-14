# Generate Financial Forecasts and Budget Advice

**Users:** Admin

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

- **Role Access:** Only the Admin generates, enters and deletes forecasts and asks for budget advice; the Officer and the Department Head read forecasts.
- **Load Historical Transactions:** `POST /forecasts/generate` groups up to 36 months of organization ledger records by month. Cash advance releases and repayments are left out, because that money is lent out and returned rather than spent or earned.
- **Validate Financial Dataset:** generation remains available with fewer than two populated transaction months. The result warns when the history is too short for a reliable trend; manual forecast inputs retain numeric validation.
- **Apply OLS Linear Regression:** the server calculates ordinary least squares slope and intercept values for chronological monthly income and expense series, fills inactive months with zero values from the first recorded month up to the last complete month (so quiet months after the last entry count as zeros), clamps impossible negative projections, and retains the raw projection for transparency. Month parsing explicitly pins the first day so end-of-month dates cannot shift the series.
- **Forecast Budget Availability:** forecasts store predicted income, expense, and balance. Current available funds are the approved budgets of the active semester.
- **Estimate Safe Spending Limit:** a generated forecast's safe spending limit is (approved budget funds + predicted income - predicted expense) x 0.8, and its summary names those funds. A manual forecast entry (period as `YYYY-MM`) derives 80% of its balance, is labelled manual, and never drives budget advice.
- **Detect Overspending/Deficit:** budget records store overspending risk and forecasts expose predicted balances.
- **Generate Budget Advice:** advice is available for approved budgets only. A single budget is advised from its own balance plus its share (its allocation over all approved allocations) of the generated forecast for the current or next month; with no such forecast the advice uses the budget balance only and says so. Advice stored before the balance changed is shown as out of date. Deterministic rules account for current available funds, predicted income and expense, approved commitments, the warning threshold, and a safety reserve. Forecast fit quality and reliability warnings prevent a short or noisy trend from being presented as certainty.
- **Generate Financial Summary Using Groq LLM:** the server requests a constrained Groq summary and rejects copy that introduces figures absent from the calculated input. If Groq is unavailable or invalid, the OLS/risk calculation still completes with a clearly labelled deterministic summary while the `FINANCIAL_SUMMARY` AI output is recorded as failed and retryable rather than pretending the fallback was AI-generated.
