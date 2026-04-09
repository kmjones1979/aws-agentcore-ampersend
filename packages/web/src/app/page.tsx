"use client";

import { useState } from "react";
import { ToolInvoker } from "./components/ToolInvoker";
import { PaymentLog } from "./components/PaymentLog";
import { ResponsePanel } from "./components/ResponsePanel";
import { ArchitectureDiagram } from "./components/ArchitectureDiagram";
import type { PaymentEvent, ToolResponse } from "./types";

export default function Home() {
  const [paymentLog, setPaymentLog] = useState<PaymentEvent[]>([]);
  const [responses, setResponses] = useState<ToolResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const addPaymentEvent = (event: PaymentEvent) => {
    setPaymentLog((prev) => [event, ...prev]);
  };

  const handleToolResult = (response: ToolResponse) => {
    setResponses((prev) => [response, ...prev]);
  };

  return (
    <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          AgentCore + Ampersend POC
        </h1>
        <p className="text-muted text-sm">
          AWS Bedrock AgentCore &times; Ampersend x402 Payment Protocol
          &mdash; Buyer &amp; Seller Agent Demo
        </p>
      </header>

      {/* Architecture */}
      <ArchitectureDiagram />

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: invoke tools */}
        <ToolInvoker
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          onPaymentEvent={addPaymentEvent}
          onResult={handleToolResult}
        />

        {/* Right: results */}
        <ResponsePanel responses={responses} />
      </div>

      {/* Payment log */}
      <PaymentLog events={paymentLog} />
    </main>
  );
}
