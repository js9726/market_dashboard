"use client";

import { useEffect, useMemo, useState } from "react";

type TapeRow = {
  ticker: string;
  daily?: number | null;
  close?: number | null;
  price?: number | null;
};

type Snapshot = {
  groups?: Record<string, TapeRow[]>;
};

const FALLBACK_TAPE = [
  { ticker: "SPY", price: 547.21, daily: -0.31 },
  { ticker: "QQQ", price: 478.55, daily: -0.12 },
  { ticker: "IWM", price: 198.40, daily: -1.58 },
  { ticker: "DIA", price: 410.85, daily: -0.62 },
  { ticker: "VIX", price: 17.42, daily: 4.80 },
  { ticker: "TLT", price: 92.10, daily: -0.50 },
  { ticker: "GLD", price: 248.30, daily: 0.62 },
  { ticker: "IBIT", price: 64.80, daily: -1.71 },
];

function signedPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function MarketTape() {
  const [rows, setRows] = useState<TapeRow[]>(FALLBACK_TAPE);

  useEffect(() => {
    let cancelled = false;
    fetch("/market-dashboard/snapshot.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((snapshot: Snapshot | null) => {
        if (cancelled || !snapshot?.groups?.Indices?.length) return;
        setRows(snapshot.groups.Indices.slice(0, 10));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const tape = useMemo(() => [...rows, ...rows], [rows]);

  return (
    <div className="market-tape" aria-label="Market tape">
      <div className="market-tape__track">
        {tape.map((row, index) => {
          const change = row.daily ?? null;
          const price = row.price ?? row.close ?? null;
          return (
            <span className="market-tape__item" key={`${row.ticker}-${index}`}>
              <span className="market-tape__symbol">{row.ticker}</span>
              <span className="market-tape__price">
                {price == null ? "-" : price.toFixed(2)}
              </span>
              <span className={change != null && change >= 0 ? "gain" : "loss"}>
                {signedPercent(change)}
              </span>
              <span className="market-tape__dot" />
            </span>
          );
        })}
      </div>
    </div>
  );
}
