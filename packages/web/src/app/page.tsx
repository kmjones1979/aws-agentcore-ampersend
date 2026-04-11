"use client";

import { useState, useCallback, useId } from "react";
import { ToolInvoker } from "./components/ToolInvoker";
import { PaymentLog } from "./components/PaymentLog";
import { ResponsePanel } from "./components/ResponsePanel";
import { ArchitectureDiagram } from "./components/ArchitectureDiagram";
import { GovernanceDashboard } from "./components/GovernanceDashboard";
import type { PaymentEvent, ToolResponse, SessionLedger, MemoryInfo } from "./types";

export default function Home() {
  const sessionId = useId();
  const [paymentLog, setPaymentLog] = useState<PaymentEvent[]>([]);
  const [responses, setResponses] = useState<ToolResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [ledger, setLedger] = useState<SessionLedger>({ totalSpent: 0, callCounts: {} });
  const [memoryInfo, setMemoryInfo] = useState<MemoryInfo>({ cacheHit: false, allTimeSpent: 0, priorRecords: 0 });
  const [cacheHits, setCacheHits] = useState(0);
  const [cacheMisses, setCacheMisses] = useState(0);

  const addPaymentEvent = useCallback((event: PaymentEvent) => {
    setPaymentLog((prev) => [event, ...prev]);
  }, []);

  const handleToolResult = useCallback((response: ToolResponse) => {
    setResponses((prev) => [response, ...prev]);
  }, []);

  const handleGovernanceUpdate = useCallback((newLedger: SessionLedger, newMemory: MemoryInfo, cacheHit: boolean) => {
    setLedger(newLedger);
    setMemoryInfo(newMemory);
    if (cacheHit) {
      setCacheHits((p) => p + 1);
    } else {
      setCacheMisses((p) => p + 1);
    }
  }, []);

  return (
    <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">
          AgentCore + Ampersend POC
        </h1>
        <p className="text-muted text-sm">
          AWS Bedrock AgentCore &times; Ampersend x402 &mdash; Policy, Memory, Observability + On-chain USDC Settlement
        </p>
      </header>

      <ArchitectureDiagram />

      <GovernanceDashboard
        sessionId={sessionId}
        ledger={ledger}
        memory={memoryInfo}
        cacheHits={cacheHits}
        cacheMisses={cacheMisses}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ToolInvoker
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          onPaymentEvent={addPaymentEvent}
          onResult={handleToolResult}
          onGovernanceUpdate={handleGovernanceUpdate}
        />
        <ResponsePanel responses={responses} />
      </div>

      <PaymentLog events={paymentLog} />
    </main>
  );
}
