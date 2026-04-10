/**
 * OpenTelemetry instrumentation for AgentCore x402 flows.
 *
 * Provides spans for the full payment lifecycle:
 *   session → tool_call → policy_check → memory_lookup → payment_sign → [result]
 *
 * Runs locally with a console exporter. Set OTEL_EXPORTER_OTLP_ENDPOINT
 * to send to ADOT / CloudWatch when deployed to AgentCore.
 *
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html
 */

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  trace,
  type Tracer,
  type Span,
  SpanStatusCode,
  context as otelContext,
} from "@opentelemetry/api";

let initialized = false;
let provider: NodeTracerProvider | null = null;

export function initTelemetry(serviceName: string): Tracer {
  if (!initialized) {
    const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName });

    const spanProcessors: ConstructorParameters<typeof NodeTracerProvider>[0]["spanProcessors"] = [
      new SimpleSpanProcessor(new ConsoleSpanExporter()),
    ];
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (otlpEndpoint) {
      spanProcessors.push(new SimpleSpanProcessor(new OTLPTraceExporter({ url: otlpEndpoint })));
    }

    provider = new NodeTracerProvider({ resource, spanProcessors });
    provider.register();
    initialized = true;
  }

  return trace.getTracer(serviceName);
}

export async function shutdownTelemetry(): Promise<void> {
  if (provider) {
    await provider.shutdown();
    initialized = false;
    provider = null;
  }
}

/**
 * Run an async function inside a named span, automatically recording
 * success/failure status and any attributes.
 */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

export { trace, SpanStatusCode, otelContext };
export type { Tracer, Span };
