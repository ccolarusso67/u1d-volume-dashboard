"use client";

import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

// Category palette. Single source of truth for the stacked-bar chart
// after PR 002 collapsed the Heavy/Light oil split into a single "Oil"
// category that mirrors the packages.family enum.
// Shared category palette (redesign system). Reused by the overview donut so
// the stacked-trend chart and the mix donut color categories identically.
// Conventional fluid colors so the mix reads at a glance.
export const CATEGORY_COLORS: Record<string, string> = {
  "Oil":      "#E0A100",  // amber/gold — motor oil
  "Coolant":  "#2E9E5B",  // green — antifreeze
  "WW":       "#1C6FB8",  // blue — windshield washer
  "DEF":      "#17B0A0",  // teal — DEF (AdBlue-adjacent, distinct from WW blue)
  "Other":    "#8A95A3",  // slate
};

export type StackedTrendRow = {
  month: string;
  [category: string]: string | number;
};

export function StackedTrendChart({
  data,
  categories,
}: {
  data: StackedTrendRow[];
  categories: string[];
}) {
  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#374151" }} />
        <YAxis
          tick={{ fontSize: 11, fill: "#374151" }}
          tickFormatter={(v: any) => Number(v).toLocaleString()}
        />
        <Tooltip
          formatter={(value: any) => [Number(value).toLocaleString() + " gal", ""]}
          contentStyle={{ fontSize: 12, borderRadius: 2 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        {categories.map((cat) => (
          <Bar
            key={cat}
            dataKey={cat}
            stackId="vol"
            fill={CATEGORY_COLORS[cat] ?? "#9CA3AF"}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
