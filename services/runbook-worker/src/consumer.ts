import { config } from './config.js';
import { redis } from './redis.js';
import { executeRunbook, type ExecutionContext } from './executor.js';

const STREAM_KEY = 'stream:runbook-executions';

let running = false;

/**
 * Ensures the consumer group exists on the runbook-executions stream.
 * Uses MKSTREAM to create the stream if it doesn't exist.
 */
export async function ensureConsumerGroup(): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, config.consumer.group, '0', 'MKSTREAM');
  } catch (err: unknown) {
    // Group already exists — ignore BUSYGROUP error
    if (err instanceof Error && !err.message.includes('BUSYGROUP')) {
      throw err;
    }
  }
}

/**
 * Processes a single message from the stream.
 * Parses the execution context and delegates to the step executor.
 */
async function processMessage(messageId: string, fields: string[]): Promise<void> {
  // Convert flat field array to key-value object
  const data: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    data[fields[i]] = fields[i + 1];
  }

  const { executionId, runbookId, incidentId } = data;

  if (!executionId || !runbookId || !incidentId) {
    console.error(`Invalid message ${messageId}: missing required fields`, data);
    await redis.xack(STREAM_KEY, config.consumer.group, messageId);
    return;
  }

  const context: ExecutionContext = {
    executionId,
    runbookId,
    incidentId,
  };

  console.log(`Executing runbook: executionId=${executionId}, runbookId=${runbookId}, incidentId=${incidentId}`);

  try {
    await executeRunbook(context);
    console.log(`Runbook execution completed: ${executionId}`);
  } catch (err) {
    console.error(`Runbook execution failed: ${executionId}`, err);
  }

  // Acknowledge the message regardless of outcome
  await redis.xack(STREAM_KEY, config.consumer.group, messageId);
}

/**
 * Main consumer loop. Uses XREADGROUP with BLOCK to wait for new messages.
 */
async function consumeLoop(): Promise<void> {
  while (running) {
    try {
      const results = await redis.xreadgroup(
        'GROUP',
        config.consumer.group,
        config.consumer.name,
        'COUNT',
        config.consumer.batchSize,
        'BLOCK',
        config.consumer.blockTimeout,
        'STREAMS',
        STREAM_KEY,
        '>'
      );

      if (results) {
        for (const [, messages] of results) {
          for (const [id, fields] of messages) {
            await processMessage(id, fields);
          }
        }
      }
    } catch (err) {
      if (running) {
        console.error('Error consuming messages:', err);
        // Back off briefly on errors before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}

/**
 * Starts the consumer loop.
 */
export function startConsumer(): void {
  running = true;
  console.log(`Consumer started (group: ${config.consumer.group}, consumer: ${config.consumer.name})`);
  consumeLoop().catch((err) => {
    console.error('Consumer loop exited unexpectedly:', err);
  });
}

/**
 * Signals the consumer to stop processing after the current iteration.
 */
export function stopConsumer(): void {
  running = false;
}
