# Together AI for Sahayak

Sahayak selects its model independently of AI-Agent-Platform. This configuration covers AI calls executed inside Sahayak, including conversation tool calls, intake summaries and note drafts. It does not change models for work executed inside the external platform, telephone connectivity or speech services.

## Configure and test

The server-only .env file supports:

```dotenv
LLM_PROVIDER=together
TOGETHER_API_KEY=your-key
TOGETHER_MODEL=openai/gpt-oss-120b
TOGETHER_REASONING_EFFORT=low
LLM_TIMEOUT_MS=8000
```

Keep the key out of chat, browser code and Git. Existing LLM_API_KEY, LLM_MODEL and LLM_BASE_URL settings belong to the NVIDIA provider and are ignored when Together is selected. Missing credentials for the selected provider leave the app in scripted mode; it never borrows credentials from another provider.

Before switching the running server, leave its current provider selection unchanged and run:

```sh
LLM_PROVIDER=together pnpm check:model
LLM_PROVIDER=together pnpm eval
```

The first command makes two small requests using synthetic inputs to check text and tool calling. It does not read patient records. The evaluation creates synthetic clinic data and tests the existing safety scenarios. Both commands incur Together usage when a key is configured.

These checks are prerequisites, not proof of clinical safety or Hindi quality across all conversations. Review synthetic Hindi conversations, drafts and response latency before real clinic use. GPT-OSS reasoning consumes the completion budget; a truncated or reasoning-only answer is rejected and existing failure handling applies. The app does not silently increase token budgets or switch to a more expensive provider.

After successful testing, set LLM_PROVIDER=together and restart the API. Changing .env alone may not restart the development watcher. Docker Compose passes the same provider settings; recreate the API container after changing them.

To switch back, set LLM_PROVIDER=nemotron and restart. To disable model calls, set LLM_PROVIDER=offline. The isolated browser test runner explicitly uses offline mode, even when Together credentials are present.

## Model choice and cost

GPT-OSS 120B is a candidate for evaluation, not a validated default for clinical use. Together lists openai/gpt-oss-120b at $0.15 per million input tokens and $0.60 per million output tokens (checked 5 October 2026). For illustration, 1,000 requests with 1,000 input and 500 billed output tokens each cost approximately $0.45, excluding extra tool turns, retries and other services. Actual costs and savings require usage measurement.

Set TOGETHER_MODEL to another Together chat model ID to evaluate it. Models used for conversations must support tool calling; compatibility and quality must be checked again after switching. Low reasoning effort is sent only for GPT-OSS models.

This change adds server configuration and a connection test. It does not add the proposed administrator model-management screen, per-task routing, billing dashboard or automatic provider fallback.

Sources:
- [Together API compatibility](https://docs.together.ai/docs/inference/openai-compatibility)
- [Available models](https://docs.together.ai/docs/serverless/models)
- [GPT-OSS reasoning controls](https://docs.together.ai/docs/gpt-oss)
- [Current pricing](https://www.together.ai/pricing)
