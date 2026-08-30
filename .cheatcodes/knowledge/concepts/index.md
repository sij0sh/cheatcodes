# Concepts

## Decision

- [Keep the Pi extension as a detached one-way launcher](6cf7bf3342.md) [draft] - The Pi extension should launch Cheatcodes without synchronous back-and-forth communication or foreground work during Pi startup.
- [Use global configuration with an optionless automatic entry point](2fad95eef7.md) [draft] - Store user settings globally and give launchers a stable command that checks, initializes, and runs Cheatcodes for a repository.

## Gotcha

- [Use the Azure Responses provider for GPT-5.6 Luna](7fa22339ce.md) [draft] - gpt-5.6-luna is registered under azure-gateway-responses, not z-ai-openai.

## Runbook

- [Run the opt-in live model smoke test](4fa2bab553.md) [draft] - Run the live smoke test with the Azure Responses GPT-5.6 Luna model while keeping it out of CI-required test suites.
